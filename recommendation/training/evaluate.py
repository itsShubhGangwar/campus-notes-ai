"""
CampusNotes AI — Recommendation Model Independent Offline Evaluation
====================================================================

Module: recommendation/training/evaluate.py
Purpose: Independently loads the saved recommendation model artifact
         (recommendation_model.joblib) and evaluates performance against
         the held-out test split without retraining.

Safety Notice:
This model is an offline bootstrap model trained on synthetic interactions
generated from the real CampusNotes academic catalog. Its metrics do not
represent real student recommendation performance.
"""

import json
from pathlib import Path
import sys
from typing import Any, Dict, List
import warnings

import joblib
import numpy as np
import pandas as pd
from sklearn.metrics import log_loss, roc_auc_score

# Suppress harmless warnings
warnings.filterwarnings("ignore", category=UserWarning)

# Local imports
PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from recommendation.features.feature_pipeline import (
    FEATURE_COLUMNS,
    METADATA_COLUMNS,
    TARGET_COLUMN,
    load_dataset,
    prepare_features,
)
from recommendation.training.train import (
    evaluate_classifier,
    ndcg_at_k,
    precision_at_k,
    temporal_split,
)


def load_model_artifact(model_path: Path) -> Dict[str, Any]:
    """
    Loads and validates the serialized recommendation model artifact.
    """
    if not model_path.exists():
        raise FileNotFoundError(f"Model artifact not found at: {model_path}")

    artifact = joblib.load(model_path)

    # Validate essential artifact components
    required_keys = ["model", "pipeline", "feature_columns", "training_config", "version"]
    for key in required_keys:
        if key not in artifact:
            raise ValueError(f"Malformed model artifact: missing key '{key}'")

    return artifact


def main() -> None:
    dataset_path = PROJECT_ROOT / "recommendation" / "data" / "synthetic" / "synthetic_training_dataset.csv"
    model_path = PROJECT_ROOT / "recommendation" / "models" / "recommendation_model.joblib"
    metrics_path = PROJECT_ROOT / "recommendation" / "models" / "evaluation_metrics.json"

    print("=" * 70)
    print("CampusNotes AI - Independent Recommendation Model Evaluation")
    print("=" * 70)

    # 1. Load Model Artifact
    print(f"\n1. Loading model artifact from: {model_path}")
    artifact = load_model_artifact(model_path)
    model = artifact["model"]
    pipeline = artifact["pipeline"]
    model_version = artifact.get("version", "unknown")
    trained_at = artifact.get("trained_at", "unknown")
    model_type = type(model).__name__

    print(f"   Model Type:    {model_type}")
    print(f"   Model Version: {model_version}")
    print(f"   Trained At:    {trained_at}")
    print(f"   Feature Count: {len(artifact['feature_columns'])}")

    # 2. Load and Split Dataset (Strict Temporal Split)
    print(f"\n2. Loading dataset and extracting held-out test split...")
    df = load_dataset(dataset_path)
    _, _, test_df = temporal_split(df, train_ratio=0.70, val_ratio=0.15)
    print(f"   Test split rows: {len(test_df)} ({test_df['target'].sum()} positives, {test_df['target'].mean():.2%})")
    print(f"   Test timestamp range: {test_df['timestamp'].min()[:10]} to {test_df['timestamp'].max()[:10]}")

    # 3. Transform Test Features Using Artifact Pipeline (No Retraining)
    print(f"\n3. Preprocessing test features using saved pipeline (no fitting)...")
    X_test, y_test, meta_test, _ = prepare_features(
        test_df, preprocessor=pipeline, fit=False, is_training=True
    )
    print(f"   Preprocessed X_test shape: {X_test.shape}")
    print(f"   Preprocessed y_test shape: {y_test.shape}")

    # 4. Generate Predictions & Evaluate Metrics
    print(f"\n4. Generating predictions and computing evaluation metrics...")
    test_metrics = evaluate_classifier(model, X_test, y_test, meta_test, split_name="test")

    print("\n" + "=" * 70)
    print("HELD-OUT TEST SET EVALUATION REPORT")
    print("=" * 70)
    print(f"Model: {model_type} (Version {model_version})")
    print(f"Test Set Size: {len(test_df)} rows ({meta_test['user_id'].nunique()} unique students)")
    print("-" * 70)
    print(f"Classification Metrics:")
    print(f"  ROC-AUC:       {test_metrics['roc_auc']:.4f}")
    print(f"  Log Loss:      {test_metrics['log_loss']:.6f}")
    print(f"\nRanking Metrics (Evaluated Per-User):")
    print(f"  Precision@5:   {test_metrics['p@5']:.4f}  (Top 5 slate precision)")
    print(f"  NDCG@5:        {test_metrics['ndcg@5']:.4f}  (Top 5 ranking gain)")
    print(f"  Precision@10:  {test_metrics['p@10']:.4f}  (Top 10 slate precision)")
    print(f"  NDCG@10:       {test_metrics['ndcg@10']:.4f}  (Top 10 ranking gain)")
    print("-" * 70)

    # 5. Reproducibility Check Against Stored Metrics JSON
    if metrics_path.exists():
        with open(metrics_path, "r", encoding="utf-8") as f:
            stored_metrics = json.load(f)
        stored_lgb = stored_metrics.get("lightgbm", {}).get("test", {})
        stored_auc = stored_lgb.get("roc_auc")
        stored_ndcg5 = stored_lgb.get("ndcg@5")
        if stored_auc is not None and stored_ndcg5 is not None:
            assert np.isclose(test_metrics["roc_auc"], stored_auc), "ROC-AUC mismatch with stored metrics!"
            assert np.isclose(test_metrics["ndcg@5"], stored_ndcg5), "NDCG@5 mismatch with stored metrics!"
            print("Reproducibility Check: PASSED (Identical results to training execution)")

    print("\n" + "=" * 70)
    print("Offline evaluation completed successfully.")
    print("=" * 70)


if __name__ == "__main__":
    main()
