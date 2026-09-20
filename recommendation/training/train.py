"""
CampusNotes AI — Recommendation Model Training & Evaluation
============================================================

Module: recommendation/training/train.py
Purpose: Trains baseline (Logistic Regression) and production candidate (LightGBM)
         models on the CampusNotes recommendation dataset using strict temporal
         train/validation/test splits, per-user ranking metrics, and feature importance
         extraction.

Safety Notice:
This model is an offline bootstrap model trained on synthetic interactions
generated from the real CampusNotes academic catalog. Its metrics do not
represent real student recommendation performance.
"""

import datetime
import json
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
import warnings

import joblib
from lightgbm import LGBMClassifier, early_stopping, log_evaluation
import numpy as np
import pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import log_loss, roc_auc_score

# Suppress harmless LightGBM deprecation notices
warnings.filterwarnings("ignore", category=UserWarning)

# Local imports
import sys
PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from recommendation.features.feature_pipeline import (
    FEATURE_COLUMNS,
    METADATA_COLUMNS,
    TARGET_COLUMN,
    load_dataset,
    prepare_features,
)

# Deterministic random seed
RANDOM_SEED = 42


# ==============================================================================
# 1. TEMPORAL TRAIN / VALIDATION / TEST SPLIT & LEAKAGE CHECKS
# ==============================================================================

def temporal_split(
    df: pd.DataFrame,
    train_ratio: float = 0.70,
    val_ratio: float = 0.15,
) -> Tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    """
    Performs a strict temporal train / validation / test split.

    Preserves temporal causality:
    - Train: earliest 70%
    - Validation: next 15%
    - Test: latest 15%

    Args:
        df: Input DataFrame with 'timestamp' column.
        train_ratio: Proportion for training (default 0.70).
        val_ratio: Proportion for validation (default 0.15).

    Returns:
        Tuple of (train_df, val_df, test_df)
    """
    if "timestamp" not in df.columns:
        raise ValueError("DataFrame must contain 'timestamp' column for temporal splitting.")

    # Sort strictly chronologically
    sorted_df = df.sort_values("timestamp").reset_index(drop=True)
    n = len(sorted_df)

    n_train = int(train_ratio * n)
    n_val = int(val_ratio * n)

    train_df = sorted_df.iloc[:n_train].copy().reset_index(drop=True)
    val_df = sorted_df.iloc[n_train : n_train + n_val].copy().reset_index(drop=True)
    test_df = sorted_df.iloc[n_train + n_val :].copy().reset_index(drop=True)

    return train_df, val_df, test_df


def validate_leakage(
    train_df: pd.DataFrame,
    val_df: pd.DataFrame,
    test_df: pd.DataFrame,
    X_train: pd.DataFrame,
    X_val: pd.DataFrame,
    X_test: pd.DataFrame,
) -> None:
    """
    Strictly validates temporal ordering and feature cleanliness to prevent data leakage.
    """
    # 1. Temporal ordering assertion
    train_max_ts = train_df["timestamp"].max()
    val_min_ts = val_df["timestamp"].min()
    val_max_ts = val_df["timestamp"].max()
    test_min_ts = test_df["timestamp"].min()

    if str(train_max_ts) > str(val_min_ts):
        raise AssertionError(
            f"Temporal Leakage: Train max timestamp ({train_max_ts}) > Val min timestamp ({val_min_ts})"
        )
    if str(val_max_ts) > str(test_min_ts):
        raise AssertionError(
            f"Temporal Leakage: Val max timestamp ({val_max_ts}) > Test min timestamp ({test_min_ts})"
        )

    # 2. Metadata and target leakage assertions
    for name, X_split in [("train", X_train), ("val", X_val), ("test", X_test)]:
        for meta_col in METADATA_COLUMNS:
            if meta_col in X_split.columns:
                raise AssertionError(f"Leakage: Metadata column '{meta_col}' found in X_{name}")
        if TARGET_COLUMN in X_split.columns:
            raise AssertionError(f"Leakage: Target column '{TARGET_COLUMN}' found in X_{name}")
        if list(X_split.columns) != FEATURE_COLUMNS:
            raise AssertionError(f"Column order mismatch in X_{name}")
        if X_split.isnull().sum().sum() > 0:
            raise AssertionError(f"NaN values found in X_{name}")
        if np.isinf(X_split.to_numpy()).any():
            raise AssertionError(f"Infinite values found in X_{name}")


# ==============================================================================
# 2. PER-USER RANKING METRICS
# ==============================================================================

def precision_at_k(y_true: np.ndarray, y_score: np.ndarray, k: int = 5) -> float:
    """
    Computes Precision@K for a single user's ranked candidate list.

    Args:
        y_true: Ground truth binary relevance array (0 or 1).
        y_score: Predicted continuous probability or score array.
        k: Cutoff rank.

    Returns:
        float: Precision@K in [0.0, 1.0].
    """
    if len(y_true) == 0 or k <= 0:
        return 0.0

    k_eff = min(k, len(y_true))
    ranked_indices = np.argsort(-y_score)[:k_eff]
    relevant_in_top_k = np.sum(y_true[ranked_indices] == 1)
    return float(relevant_in_top_k / k)


def ndcg_at_k(y_true: np.ndarray, y_score: np.ndarray, k: int = 5) -> float:
    """
    Computes Normalized Discounted Cumulative Gain (NDCG@K) for a single user's candidate list.

    Args:
        y_true: Ground truth binary relevance array (0 or 1).
        y_score: Predicted continuous probability or score array.
        k: Cutoff rank.

    Returns:
        float: NDCG@K in [0.0, 1.0].
    """
    if len(y_true) == 0 or k <= 0:
        return 0.0

    k_eff = min(k, len(y_true))

    # 1. DCG@K: sorted by predicted scores
    ranked_indices = np.argsort(-y_score)[:k_eff]
    gains = y_true[ranked_indices]
    discounts = np.log2(np.arange(1, k_eff + 1) + 1.0)
    dcg = np.sum(gains / discounts)

    # 2. IDCG@K: ideal sorting by true relevance
    ideal_gains = np.sort(y_true)[::-1][:k_eff]
    idcg = np.sum(ideal_gains / discounts)

    if idcg <= 0.0:
        return 0.0

    return float(dcg / idcg)


def evaluate_ranking(
    meta_df: pd.DataFrame,
    y_true: pd.Series,
    y_prob: np.ndarray,
    ks: List[int] = [5, 10],
) -> Dict[str, float]:
    """
    Computes per-user Precision@K and NDCG@K, averaging results across all users.

    Args:
        meta_df: Metadata DataFrame containing 'user_id'.
        y_true: Series of true binary labels.
        y_prob: Array of predicted model probabilities.
        ks: List of rank cutoffs (default [5, 10]).

    Returns:
        Dict mapping metric name to average value.
    """
    eval_df = meta_df[["user_id"]].copy()
    eval_df["y_true"] = y_true.values
    eval_df["y_prob"] = y_prob

    metrics: Dict[str, float] = {}

    for k in ks:
        user_p_list: List[float] = []
        user_ndcg_list: List[float] = []

        for user_id, group in eval_df.groupby("user_id"):
            yt = group["y_true"].values
            yp = group["y_prob"].values
            user_p_list.append(precision_at_k(yt, yp, k=k))
            user_ndcg_list.append(ndcg_at_k(yt, yp, k=k))

        metrics[f"p@{k}"] = float(np.mean(user_p_list)) if user_p_list else 0.0
        metrics[f"ndcg@{k}"] = float(np.mean(user_ndcg_list)) if user_ndcg_list else 0.0

    return metrics


def evaluate_classifier(
    model: Any,
    X: pd.DataFrame,
    y: pd.Series,
    meta_df: pd.DataFrame,
    split_name: str = "val",
) -> Dict[str, float]:
    """
    Evaluates classification performance (ROC-AUC, Log Loss) and per-user ranking metrics.
    """
    y_prob = model.predict_proba(X)[:, 1]

    # Clip probabilities slightly to prevent log(0)
    eps = 1e-15
    y_prob_clipped = np.clip(y_prob, eps, 1.0 - eps)

    roc_auc = float(roc_auc_score(y, y_prob))
    logloss = float(log_loss(y, y_prob_clipped))

    ranking_metrics = evaluate_ranking(meta_df, y, y_prob, ks=[5, 10])

    return {
        "roc_auc": roc_auc,
        "log_loss": logloss,
        "p@5": ranking_metrics["p@5"],
        "ndcg@5": ranking_metrics["ndcg@5"],
        "p@10": ranking_metrics["p@10"],
        "ndcg@10": ranking_metrics["ndcg@10"],
    }


# ==============================================================================
# 3. MODEL TRAINING
# ==============================================================================

def train_baseline(X_train: pd.DataFrame, y_train: pd.Series) -> LogisticRegression:
    """
    Trains baseline Logistic Regression model with balanced class weights.
    """
    model = LogisticRegression(
        max_iter=1000,
        class_weight="balanced",
        random_state=RANDOM_SEED,
    )
    model.fit(X_train, y_train)
    return model


def train_lightgbm(
    X_train: pd.DataFrame,
    y_train: pd.Series,
    X_val: pd.DataFrame,
    y_val: pd.Series,
) -> LGBMClassifier:
    """
    Trains LightGBM classifier with conservative parameters and early stopping on validation.
    """
    model = LGBMClassifier(
        n_estimators=300,
        learning_rate=0.05,
        num_leaves=31,
        max_depth=-1,
        subsample=0.8,
        colsample_bytree=0.8,
        random_state=RANDOM_SEED,
        class_weight="balanced",
        verbosity=-1,
    )

    callbacks = [
        early_stopping(stopping_rounds=30, verbose=False),
        log_evaluation(period=0),
    ]

    model.fit(
        X_train,
        y_train,
        eval_set=[(X_val, y_val)],
        callbacks=callbacks,
    )
    return model


# ==============================================================================
# 4. ARTIFACT EXPORT
# ==============================================================================

def save_model(
    model: Any,
    pipeline: Any,
    output_path: Path,
    training_config: Dict[str, Any],
) -> None:
    """
    Serializes the trained model bundled with the fitted feature pipeline.
    """
    output_path.parent.mkdir(parents=True, exist_ok=True)
    artifact = {
        "model": model,
        "pipeline": pipeline,
        "feature_columns": FEATURE_COLUMNS,
        "metadata_columns": METADATA_COLUMNS,
        "target_column": TARGET_COLUMN,
        "training_config": training_config,
        "version": "1.0.0",
        "trained_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "model_type": type(model).__name__,
        "dataset_type": "SYNTHETIC_OFFLINE_BOOTSTRAP",
    }
    joblib.dump(artifact, output_path)
    print(f"Saved model artifact to: {output_path}")


def save_feature_importance(
    model: LGBMClassifier, output_path: Path
) -> pd.DataFrame:
    """
    Extracts and exports feature importances to CSV.
    """
    output_path.parent.mkdir(parents=True, exist_ok=True)
    importances = pd.DataFrame(
        {
            "feature": FEATURE_COLUMNS,
            "importance": model.feature_importances_,
        }
    ).sort_values("importance", ascending=False).reset_index(drop=True)

    importances.to_csv(output_path, index=False)
    print(f"Saved feature importances to: {output_path}")
    return importances


def save_metrics(metrics: Dict[str, Any], output_path: Path) -> None:
    """
    Exports evaluation metrics to JSON.
    """
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(metrics, f, indent=2)
    print(f"Saved evaluation metrics to: {output_path}")


# ==============================================================================
# 5. MAIN TRAINING & EVALUATION PIPELINE
# ==============================================================================

def main() -> None:
    dataset_path = PROJECT_ROOT / "recommendation" / "data" / "synthetic" / "synthetic_training_dataset.csv"
    model_path = PROJECT_ROOT / "recommendation" / "models" / "recommendation_model.joblib"
    metrics_path = PROJECT_ROOT / "recommendation" / "models" / "evaluation_metrics.json"
    importance_path = PROJECT_ROOT / "recommendation" / "models" / "feature_importance.csv"

    print("=" * 70)
    print("CampusNotes AI - Recommendation Model Training & Evaluation")
    print("=" * 70)

    # 1. Load dataset
    print(f"\nLoading dataset from: {dataset_path}")
    df = load_dataset(dataset_path)
    total_rows = len(df)
    total_pos = int(df["target"].sum())
    total_neg = total_rows - total_pos
    print(f"Total dataset rows: {total_rows} (Positives: {total_pos}, Negatives: {total_neg})")

    # 2. Temporal train / validation / test split
    print("\nExecuting temporal split (70% Train, 15% Validation, 15% Test)...")
    train_df, val_df, test_df = temporal_split(df, train_ratio=0.70, val_ratio=0.15)

    print(f"Train rows:      {len(train_df):>5} | Positives: {train_df['target'].sum():>4} ({train_df['target'].mean():.2%}) | Span: {train_df['timestamp'].min()[:10]} to {train_df['timestamp'].max()[:10]}")
    print(f"Validation rows: {len(val_df):>5} | Positives: {val_df['target'].sum():>4} ({val_df['target'].mean():.2%}) | Span: {val_df['timestamp'].min()[:10]} to {val_df['timestamp'].max()[:10]}")
    print(f"Test rows:       {len(test_df):>5} | Positives: {test_df['target'].sum():>4} ({test_df['target'].mean():.2%}) | Span: {test_df['timestamp'].min()[:10]} to {test_df['timestamp'].max()[:10]}")

    # 3. Fit feature pipeline ONLY on train split
    print("\nFitting feature pipeline strictly on training split...")
    X_train, y_train, meta_train, fitted_pipeline = prepare_features(
        train_df, fit=True, is_training=True
    )
    print(f"Transforming validation split with fitted pipeline...")
    X_val, y_val, meta_val, _ = prepare_features(
        val_df, preprocessor=fitted_pipeline, fit=False, is_training=True
    )
    print(f"Transforming test split with fitted pipeline...")
    X_test, y_test, meta_test, _ = prepare_features(
        test_df, preprocessor=fitted_pipeline, fit=False, is_training=True
    )

    # 4. Validate data leakage
    print("\nRunning automated data leakage validation checks...")
    validate_leakage(train_df, val_df, test_df, X_train, X_val, X_test)
    print("  [OK] Temporal ordering verified (train <= val <= test).")
    print("  [OK] Pipeline fit exclusively on training data.")
    print("  [OK] Zero metadata or target leakage in feature matrices.")
    print("  [OK] Zero NaN or infinite values detected.")

    # 5. Train Baseline Model (Logistic Regression)
    print("\n" + "-" * 70)
    print("Training Baseline Model: Logistic Regression (class_weight='balanced')...")
    lr_model = train_baseline(X_train, y_train)
    lr_val_metrics = evaluate_classifier(lr_model, X_val, y_val, meta_val, split_name="val")
    lr_test_metrics = evaluate_classifier(lr_model, X_test, y_test, meta_test, split_name="test")

    # 6. Train LightGBM Model
    print("\nTraining LightGBM Classifier (early_stopping on validation set)...")
    lgb_config = {
        "n_estimators": 300,
        "learning_rate": 0.05,
        "num_leaves": 31,
        "max_depth": -1,
        "subsample": 0.8,
        "colsample_bytree": 0.8,
        "random_state": RANDOM_SEED,
        "class_weight": "balanced",
    }
    lgb_model = train_lightgbm(X_train, y_train, X_val, y_val)
    best_iter = getattr(lgb_model, "best_iteration_", 300)
    print(f"  LightGBM best iteration: {best_iter}")

    lgb_val_metrics = evaluate_classifier(lgb_model, X_val, y_val, meta_val, split_name="val")
    lgb_test_metrics = evaluate_classifier(lgb_model, X_test, y_test, meta_test, split_name="test")

    # 7. Model Comparison Table
    print("\n" + "=" * 70)
    print("MODEL EVALUATION COMPARISON")
    print("=" * 70)
    header = f"{'Model':<22} {'Split':<6} {'ROC-AUC':<9} {'LogLoss':<9} {'P@5':<8} {'NDCG@5':<8} {'P@10':<8} {'NDCG@10':<8}"
    print(header)
    print("-" * 70)

    for m_name, val_m, test_m in [
        ("Logistic Regression", lr_val_metrics, lr_test_metrics),
        ("LightGBM", lgb_val_metrics, lgb_test_metrics),
    ]:
        print(f"{m_name:<22} {'Val':<6} {val_m['roc_auc']:<9.4f} {val_m['log_loss']:<9.4f} {val_m['p@5']:<8.4f} {val_m['ndcg@5']:<8.4f} {val_m['p@10']:<8.4f} {val_m['ndcg@10']:<8.4f}")
        print(f"{m_name:<22} {'Test':<6} {test_m['roc_auc']:<9.4f} {test_m['log_loss']:<9.4f} {test_m['p@5']:<8.4f} {test_m['ndcg@5']:<8.4f} {test_m['p@10']:<8.4f} {test_m['ndcg@10']:<8.4f}")
        print("-" * 70)

    # 8. Feature Importance
    print("\nExtracting LightGBM feature importances...")
    imp_df = save_feature_importance(lgb_model, importance_path)
    print("\nTop 10 Most Important Features:")
    for idx, row in imp_df.head(10).iterrows():
        print(f"  {idx+1:>2}. {row['feature']:<32}: {row['importance']}")

    # 9. Save Model Artifact
    save_model(lgb_model, fitted_pipeline, model_path, lgb_config)

    # 10. Save Metrics JSON
    metrics_data = {
        "dataset_type": "SYNTHETIC_OFFLINE_BOOTSTRAP",
        "dataset_rows": total_rows,
        "train_rows": len(train_df),
        "validation_rows": len(val_df),
        "test_rows": len(test_df),
        "positive_rows": total_pos,
        "negative_rows": total_neg,
        "feature_count": len(FEATURE_COLUMNS),
        "feature_names": FEATURE_COLUMNS,
        "random_seed": RANDOM_SEED,
        "baseline": {
            "model_type": "LogisticRegression",
            "validation": lr_val_metrics,
            "test": lr_test_metrics,
        },
        "lightgbm": {
            "model_type": "LGBMClassifier",
            "best_iteration": int(best_iter) if best_iter is not None else 300,
            "validation": lgb_val_metrics,
            "test": lgb_test_metrics,
        },
        "synthetic_notice": (
            "This model is an offline bootstrap model trained on synthetic interactions "
            "generated from the real CampusNotes academic catalog. Its metrics do not "
            "represent real student recommendation performance."
        ),
    }
    save_metrics(metrics_data, metrics_path)

    print("\n" + "=" * 70)
    print("Model training and offline evaluation completed successfully.")
    print("=" * 70)


if __name__ == "__main__":
    main()
