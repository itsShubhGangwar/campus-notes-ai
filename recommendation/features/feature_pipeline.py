"""
CampusNotes AI — Recommendation Feature Engineering Pipeline
============================================================

Module: recommendation/features/feature_pipeline.py
Purpose: Reusable feature processing pipeline for recommendation model
         training and live recommendation inference.

Features (27 ML features):
- Academic (5): is_same_college, is_same_branch, is_same_semester,
                semester_distance, is_enrolled_subject
- User Behavior (8): user_semester, user_account_age_days, user_total_views,
                     user_total_downloads, user_total_likes, user_total_bookmarks,
                     user_total_chats, user_has_bio
- Note (10): note_page_count, note_file_size_kb, note_age_days, note_tag_count,
             note_is_processed, note_views_hist, note_downloads_hist,
             note_likes_hist, note_bookmarks_hist, note_download_view_ratio
- User-Note Affinity (3): user_subject_interaction_count, user_note_prior_views,
                          user_uploader_affinity
- Semantic (1): semantic_affinity_score

Metadata (4, excluded from ML matrix):
- user_id, note_id, timestamp, interaction_source

Target (1, excluded from ML matrix):
- target (0 = negative, 1 = positive)

Imputation Strategy:
- Zero Imputation (21 features): Where 0 has a clear semantic meaning
  (behavioral counts, activity history, ratios, cold-start defaults, binary flags).
- Median Imputation (6 features): Continuous physical measurements or demographic
  attributes where 0 would be distorted or invalid (user_semester, semester_distance,
  user_account_age_days, note_page_count, note_file_size_kb, note_age_days).
"""

from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple, Union

import numpy as np
import pandas as pd
from sklearn.base import BaseEstimator, TransformerMixin
from sklearn.compose import ColumnTransformer
from sklearn.impute import SimpleImputer
from sklearn.pipeline import Pipeline


# ==============================================================================
# 1. FEATURE DEFINITIONS & CATEGORIES
# ==============================================================================

# Academic features (5)
ACADEMIC_FEATURES: List[str] = [
    "is_same_college",
    "is_same_branch",
    "is_same_semester",
    "semester_distance",
    "is_enrolled_subject",
]

# User profile & behavioral history features (8)
USER_BEHAVIOR_FEATURES: List[str] = [
    "user_semester",
    "user_account_age_days",
    "user_total_views",
    "user_total_downloads",
    "user_total_likes",
    "user_total_bookmarks",
    "user_total_chats",
    "user_has_bio",
]

# Note document & global engagement features (10)
NOTE_FEATURES: List[str] = [
    "note_page_count",
    "note_file_size_kb",
    "note_age_days",
    "note_tag_count",
    "note_is_processed",
    "note_views_hist",
    "note_downloads_hist",
    "note_likes_hist",
    "note_bookmarks_hist",
    "note_download_view_ratio",
]

# Pairwise user-to-note affinity features (3)
USER_NOTE_AFFINITY_FEATURES: List[str] = [
    "user_subject_interaction_count",
    "user_note_prior_views",
    "user_uploader_affinity",
]

# Semantic embedding similarity features (1)
SEMANTIC_FEATURES: List[str] = [
    "semantic_affinity_score",
]

# Logical groupings
FEATURE_CATEGORIES: Dict[str, List[str]] = {
    "ACADEMIC": ACADEMIC_FEATURES,
    "USER_BEHAVIOR": USER_BEHAVIOR_FEATURES,
    "NOTE": NOTE_FEATURES,
    "USER_NOTE_AFFINITY": USER_NOTE_AFFINITY_FEATURES,
    "SEMANTIC": SEMANTIC_FEATURES,
}

# Explicit, deterministic feature column order (27 features)
FEATURE_COLUMNS: List[str] = (
    ACADEMIC_FEATURES
    + USER_BEHAVIOR_FEATURES
    + NOTE_FEATURES
    + USER_NOTE_AFFINITY_FEATURES
    + SEMANTIC_FEATURES
)

# Identifiers and metadata columns (excluded from ML feature matrix)
METADATA_COLUMNS: List[str] = [
    "user_id",
    "note_id",
    "timestamp",
    "interaction_source",
]

# Target column (excluded from X)
TARGET_COLUMN: str = "target"

# Binary indicator features (strictly 0 or 1)
BINARY_FEATURES: List[str] = [
    "is_same_college",
    "is_same_branch",
    "is_same_semester",
    "is_enrolled_subject",
    "user_has_bio",
    "note_is_processed",
]


# ==============================================================================
# 2. MISSING VALUE HANDLING STRATEGY
# ==============================================================================

# Zero-imputation (21 features):
# For behavioral counts, prior interactions, interaction ratios, and binary flags,
# zero represents the absence of activity, the cold-start default, or False.
ZERO_IMPUTE_FEATURES: List[str] = [
    # Binary flags (0 = False)
    "is_same_college",
    "is_same_branch",
    "is_same_semester",
    "is_enrolled_subject",
    "user_has_bio",
    "note_is_processed",
    # User activity counts (0 = no historical actions)
    "user_total_views",
    "user_total_downloads",
    "user_total_likes",
    "user_total_bookmarks",
    "user_total_chats",
    # Note engagement counters & ratios (0 = no engagement / 0 downloads / 0 tags)
    "note_views_hist",
    "note_downloads_hist",
    "note_likes_hist",
    "note_bookmarks_hist",
    "note_download_view_ratio",
    "note_tag_count",
    # User-note affinity counters (0 = no prior interactions)
    "user_subject_interaction_count",
    "user_note_prior_views",
    "user_uploader_affinity",
    # Semantic affinity (0.0 = cold-start default / neutral)
    "semantic_affinity_score",
]

# Median-imputation (6 features):
# For continuous physical measurements and demographic status where 0 is either
# invalid (e.g. 0 semester, 0 page count, 0 file size) or distorts distributions,
# the training cohort median provides a stable, representative baseline.
MEDIAN_IMPUTE_FEATURES: List[str] = [
    "user_semester",
    "semester_distance",
    "user_account_age_days",
    "note_page_count",
    "note_file_size_kb",
    "note_age_days",
]


# ==============================================================================
# 3. CUSTOM SCIKIT-LEARN TRANSFORMERS
# ==============================================================================

class ReorderColumns(BaseEstimator, TransformerMixin):
    """
    Custom transformer to guarantee deterministic column ordering matching
    FEATURE_COLUMNS after ColumnTransformer execution.
    """

    def __init__(self, columns: List[str]):
        self.columns = columns

    def fit(self, X: Any, y: Optional[Any] = None) -> "ReorderColumns":
        self.columns_ = list(self.columns)
        self.n_features_in_ = len(self.columns_)
        return self

    def transform(self, X: Any) -> pd.DataFrame:
        if isinstance(X, pd.DataFrame):
            return X[self.columns_]
        elif isinstance(X, np.ndarray):
            # If array, convert to DataFrame with columns_
            return pd.DataFrame(X, columns=self.columns_)[self.columns_]
        return pd.DataFrame(X, columns=self.columns_)[self.columns_]


# ==============================================================================
# 4. PIPELINE BUILDER & PREPROCESSOR
# ==============================================================================

def create_preprocessor() -> Pipeline:
    """
    Creates the scikit-learn preprocessing pipeline.

    Applies:
    1. Zero-imputation for 21 behavioral, affinity, ratio, and binary features.
    2. Median-imputation for 6 continuous physical and demographic features.
    3. ReorderColumns to strictly enforce deterministic column order.

    Returns:
        Pipeline: Configured scikit-learn Pipeline instance.
    """
    column_transformer = ColumnTransformer(
        transformers=[
            (
                "zero_imputer",
                SimpleImputer(strategy="constant", fill_value=0.0),
                ZERO_IMPUTE_FEATURES,
            ),
            (
                "median_imputer",
                SimpleImputer(strategy="median"),
                MEDIAN_IMPUTE_FEATURES,
            ),
        ],
        remainder="drop",
        verbose_feature_names_out=False,
    )
    # Configure transformer to emit pandas DataFrame
    column_transformer.set_output(transform="pandas")

    pipeline = Pipeline(
        steps=[
            ("imputer", column_transformer),
            ("reorder", ReorderColumns(FEATURE_COLUMNS)),
        ]
    )
    return pipeline


def build_feature_pipeline() -> Pipeline:
    """Convenience alias for create_preprocessor."""
    return create_preprocessor()


# ==============================================================================
# 5. ACCESSOR FUNCTIONS
# ==============================================================================

def get_feature_columns() -> List[str]:
    """Returns the ordered list of all 27 ML feature column names."""
    return list(FEATURE_COLUMNS)


def get_feature_categories() -> Dict[str, List[str]]:
    """Returns the dictionary mapping category names to feature column lists."""
    return {k: list(v) for k, v in FEATURE_CATEGORIES.items()}


def get_metadata_columns() -> List[str]:
    """Returns the list of metadata column names."""
    return list(METADATA_COLUMNS)


def get_target_column() -> str:
    """Returns the target column name."""
    return TARGET_COLUMN


def get_feature_names() -> List[str]:
    """Returns the ordered feature names."""
    return list(FEATURE_COLUMNS)


# ==============================================================================
# 6. DATA LOADING & VALIDATION
# ==============================================================================

def load_dataset(path: Union[str, Path]) -> pd.DataFrame:
    """
    Loads dataset CSV from disk.

    Args:
        path: Path to dataset CSV file.

    Returns:
        pd.DataFrame: Loaded dataset.

    Raises:
        FileNotFoundError: If path does not exist.
        ValueError: If file is empty or corrupted.
    """
    file_path = Path(path)
    if not file_path.exists():
        raise FileNotFoundError(f"Dataset not found at: {file_path}")

    df = pd.read_csv(file_path)
    if df.empty:
        raise ValueError(f"Dataset at {file_path} is empty.")
    return df


def validate_dataset(df: pd.DataFrame, is_training: bool = True) -> Dict[str, Any]:
    """
    Validates the structure, types, and values of the input dataset.

    Args:
        df: Input DataFrame to validate.
        is_training: If True, requires the target column to be present.

    Returns:
        dict: Validation results and diagnostics.

    Raises:
        ValueError: If any critical validation check fails.
    """
    results: Dict[str, Any] = {}

    # 1. Check required feature columns
    missing_features = [col for col in FEATURE_COLUMNS if col not in df.columns]
    if missing_features:
        raise ValueError(f"Missing required feature columns: {missing_features}")
    results["required_features_present"] = True

    # 2. Check duplicate column names
    if len(df.columns) != len(set(df.columns)):
        raise ValueError("Input DataFrame contains duplicate column names.")
    results["no_duplicate_columns"] = True

    # 3. Check target column if training
    if is_training:
        if TARGET_COLUMN not in df.columns:
            raise ValueError(f"Missing target column '{TARGET_COLUMN}' in training data.")
        target_unique = set(df[TARGET_COLUMN].dropna().unique())
        if not target_unique.issubset({0, 1}):
            raise ValueError(f"Target column must contain only 0 and 1, found: {target_unique}")
        results["target_valid"] = True

    # 4. Check feature numeric convertibility
    for col in FEATURE_COLUMNS:
        non_numeric = pd.to_numeric(df[col], errors="coerce").isnull() & df[col].notnull()
        if non_numeric.any():
            invalid_vals = df.loc[non_numeric, col].tolist()[:5]
            raise ValueError(
                f"Feature '{col}' contains non-numeric unparseable values: {invalid_vals}"
            )
    results["feature_types_convertible"] = True

    # 5. Check binary features values (when non-null)
    for col in BINARY_FEATURES:
        valid_binary = set(df[col].dropna().astype(int).unique()).issubset({0, 1})
        if not valid_binary:
            raise ValueError(f"Binary feature '{col}' contains values outside {{0, 1}}.")
    results["binary_features_valid"] = True

    # 6. Check infinite values
    for col in FEATURE_COLUMNS:
        numeric_series = pd.to_numeric(df[col], errors="coerce")
        if np.isinf(numeric_series).any():
            raise ValueError(f"Feature '{col}' contains infinite values.")
    results["no_infinite_values"] = True

    return results


def split_features_target(
    df: pd.DataFrame, is_training: bool = True
) -> Tuple[pd.DataFrame, Optional[pd.Series], pd.DataFrame]:
    """
    Splits the dataset into:
    - X_raw: DataFrame containing strictly FEATURE_COLUMNS in deterministic order.
    - y: Target Series (or None if not training or not present).
    - metadata: DataFrame containing present metadata columns.

    Guarantees that user_id, note_id, timestamp, interaction_source,
    and target never enter X.

    Args:
        df: Input DataFrame.
        is_training: Whether target column extraction is required.

    Returns:
        Tuple[pd.DataFrame, Optional[pd.Series], pd.DataFrame]: (X_raw, y, metadata)
    """
    # Extract metadata columns that exist in df
    present_metadata = [col for col in METADATA_COLUMNS if col in df.columns]
    metadata = df[present_metadata].copy() if present_metadata else pd.DataFrame(index=df.index)

    # Extract target
    y: Optional[pd.Series] = None
    if TARGET_COLUMN in df.columns:
        y = df[TARGET_COLUMN].astype(int).copy()
    elif is_training:
        raise ValueError(f"Target column '{TARGET_COLUMN}' required for training data.")

    # Extract ML features strictly in deterministic order
    X_raw = df[FEATURE_COLUMNS].copy()

    # Cast numeric types safely
    for col in FEATURE_COLUMNS:
        X_raw[col] = pd.to_numeric(X_raw[col], errors="coerce")

    return X_raw, y, metadata


def validate_preprocessed(
    X: pd.DataFrame, y: Optional[pd.Series] = None
) -> Dict[str, Any]:
    """
    Validates preprocessed feature matrix X and target vector y.

    Verifies:
    1. Exact deterministic feature column order.
    2. No missing (NaN) values remain.
    3. No infinite values remain.
    4. Row counts between X and y match (if y provided).
    5. No metadata or target columns leaked into X.
    6. Binary features remain in {0, 1}.

    Args:
        X: Preprocessed feature matrix.
        y: Target series (optional).

    Returns:
        dict: Validation results.
    """
    results: Dict[str, Any] = {}

    # 1. Feature columns and ordering
    if list(X.columns) != FEATURE_COLUMNS:
        raise ValueError("Preprocessed X column ordering does not match FEATURE_COLUMNS.")
    results["feature_ordering_deterministic"] = True

    # 2. No NaN values
    nan_count = int(X.isnull().sum().sum())
    if nan_count > 0:
        nan_cols = X.columns[X.isnull().any()].tolist()
        raise ValueError(f"Preprocessed X contains {nan_count} NaN values in columns: {nan_cols}")
    results["no_missing_values"] = True

    # 3. No infinite values
    if np.isinf(X.to_numpy()).any():
        raise ValueError("Preprocessed X contains infinite values.")
    results["no_infinite_values"] = True

    # 4. Row counts
    if y is not None:
        if len(X) != len(y):
            raise ValueError(f"Row count mismatch: X has {len(X)} rows, y has {len(y)} rows.")
        results["row_counts_match"] = True

    # 5. Leakage checks
    leaked_meta = [col for col in METADATA_COLUMNS if col in X.columns]
    if leaked_meta:
        raise ValueError(f"Metadata leaked into feature matrix X: {leaked_meta}")
    if TARGET_COLUMN in X.columns:
        raise ValueError(f"Target column '{TARGET_COLUMN}' leaked into feature matrix X.")
    results["no_metadata_leakage"] = True
    results["no_target_leakage"] = True

    # 6. Binary feature range
    for col in BINARY_FEATURES:
        unique_vals = set(X[col].unique())
        if not unique_vals.issubset({0.0, 1.0, 0, 1}):
            raise ValueError(f"Binary feature '{col}' contains non-binary values: {unique_vals}")
    results["binary_features_valid"] = True

    return results


# ==============================================================================
# 7. HIGH-LEVEL REUSABLE PREPARE FUNCTION
# ==============================================================================

def prepare_features(
    df: pd.DataFrame,
    preprocessor: Optional[Pipeline] = None,
    fit: bool = False,
    is_training: bool = True,
) -> Tuple[pd.DataFrame, Optional[pd.Series], pd.DataFrame, Pipeline]:
    """
    High-level reusable feature preparation pipeline.

    Works identically for:
    - Training (fit=True, is_training=True): fits preprocessor on X_raw, transforms X_raw.
    - Evaluation / Inference (fit=False, is_training=False): uses pre-fitted preprocessor.

    Args:
        df: Input DataFrame.
        preprocessor: Optional existing scikit-learn Pipeline. If None, created automatically.
        fit: If True, fits preprocessor on df. If False, requires preprocessor to be fitted.
        is_training: If True, expects target column.

    Returns:
        Tuple[pd.DataFrame, Optional[pd.Series], pd.DataFrame, Pipeline]:
            (X_processed, y, metadata, fitted_preprocessor)
    """
    # 1. Validate raw input
    validate_dataset(df, is_training=is_training)

    # 2. Separate ML features, target, and metadata
    X_raw, y, metadata = split_features_target(df, is_training=is_training)

    # 3. Create preprocessor if needed
    if preprocessor is None:
        preprocessor = create_preprocessor()
        fit = True

    # 4. Fit or transform
    if fit:
        X_processed = preprocessor.fit_transform(X_raw)
    else:
        X_processed = preprocessor.transform(X_raw)

    # Ensure output is a DataFrame with clean columns
    if not isinstance(X_processed, pd.DataFrame):
        X_processed = pd.DataFrame(X_processed, columns=FEATURE_COLUMNS, index=X_raw.index)

    # 5. Validate preprocessed output
    validate_preprocessed(X_processed, y)

    return X_processed, y, metadata, preprocessor


# ==============================================================================
# 8. SELF-VALIDATION & CLI EXECUTION
# ==============================================================================

def main() -> None:
    """
    Executes feature pipeline validation against the synthetic training dataset.
    """
    dataset_path = Path("recommendation/data/synthetic/synthetic_training_dataset.csv")

    print("=" * 60)
    print("CampusNotes AI - Feature Pipeline Validation")
    print("=" * 60)

    # 1. Load dataset
    print(f"\nDataset:")
    df = load_dataset(dataset_path)
    total_rows, total_cols = df.shape
    print(f"  Rows: {total_rows}")

    # 2. Inspect column categories
    present_meta = [c for c in METADATA_COLUMNS if c in df.columns]
    has_target = TARGET_COLUMN in df.columns
    print(f"\nFeatures:")
    print(f"  Total ML features: {len(FEATURE_COLUMNS)}")
    print(f"  Metadata columns: {len(present_meta)}")
    print(f"  Target column: {TARGET_COLUMN}")

    # 3. Prepare features (Fit + Transform)
    X, y, metadata, preprocessor = prepare_features(df, fit=True, is_training=True)

    print(f"\nX shape:")
    print(f"  {X.shape}")
    print(f"\ny shape:")
    print(f"  {y.shape if y is not None else 'None'}")

    if y is not None:
        target_counts = y.value_counts().to_dict()
        print(f"\nTarget distribution:")
        print(f"  Positive: {target_counts.get(1, 0)} ({target_counts.get(1, 0)/len(y):.2%})")
        print(f"  Negative: {target_counts.get(0, 0)} ({target_counts.get(0, 0)/len(y):.2%})")

    # 4. Check validation assertions
    val_results = validate_preprocessed(X, y)

    print("\nValidation:")
    print(f"  [OK] Required columns")
    print(f"  [OK] Feature types")
    print(f"  [OK] Binary features")
    print(f"  [OK] Target values")
    print(f"  [OK] Metadata excluded")
    print(f"  [OK] No infinite values")
    print(f"  [OK] Missing values handled")
    print(f"  [OK] Deterministic feature ordering")

    # 5. Test out-of-sample transform with missing values (simulating inference)
    test_sample = df.iloc[:10].copy()
    test_sample.loc[0, "user_total_views"] = np.nan
    test_sample.loc[0, "user_account_age_days"] = np.nan
    test_sample.loc[1, "is_same_college"] = np.nan
    test_sample.loc[1, "note_file_size_kb"] = np.nan

    X_test_trans, y_test, meta_test, _ = prepare_features(
        test_sample, preprocessor=preprocessor, fit=False, is_training=True
    )
    assert X_test_trans.isnull().sum().sum() == 0, "Out-of-sample transform produced NaNs"
    assert X_test_trans.shape == (10, len(FEATURE_COLUMNS)), "Out-of-sample transform shape mismatch"

    # 6. Test inference without target column
    inference_sample = test_sample.drop(columns=[TARGET_COLUMN, "interaction_source"])
    X_inf, y_inf, meta_inf, _ = prepare_features(
        inference_sample, preprocessor=preprocessor, fit=False, is_training=False
    )
    assert y_inf is None, "Inference mode should return None for y"
    assert X_inf.shape == (10, len(FEATURE_COLUMNS)), "Inference mode feature count mismatch"

    print("\n" + "=" * 60)
    print("Feature pipeline validation completed successfully.")
    print("=" * 60)


if __name__ == "__main__":
    main()
