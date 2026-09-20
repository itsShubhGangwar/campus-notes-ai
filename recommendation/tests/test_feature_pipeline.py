"""
CampusNotes AI — Unit & Integration Tests for Recommendation Feature Pipeline
=============================================================================

Module: recommendation/tests/test_feature_pipeline.py
Purpose: Rigorous testing of feature engineering, schema validation,
         metadata separation, deterministic ordering, missing value handling,
         and live inference reusability.
"""

import sys
from pathlib import Path
import numpy as np
import pandas as pd

# Add project root to sys.path
PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from recommendation.features.feature_pipeline import (
    FEATURE_COLUMNS,
    FEATURE_CATEGORIES,
    METADATA_COLUMNS,
    TARGET_COLUMN,
    BINARY_FEATURES,
    ZERO_IMPUTE_FEATURES,
    MEDIAN_IMPUTE_FEATURES,
    load_dataset,
    validate_dataset,
    split_features_target,
    create_preprocessor,
    prepare_features,
    validate_preprocessed,
    get_feature_columns,
    get_feature_categories,
    get_metadata_columns,
    get_target_column,
)


def test_constants_and_partitions():
    """Verify feature constants, total count, and complete partition."""
    print("Test 1: Constants and Feature Partitions...")
    assert len(FEATURE_COLUMNS) == 27, f"Expected 27 features, got {len(FEATURE_COLUMNS)}"
    assert len(ZERO_IMPUTE_FEATURES) == 21, f"Expected 21 zero-impute features, got {len(ZERO_IMPUTE_FEATURES)}"
    assert len(MEDIAN_IMPUTE_FEATURES) == 6, f"Expected 6 median-impute features, got {len(MEDIAN_IMPUTE_FEATURES)}"
    assert set(FEATURE_COLUMNS) == set(ZERO_IMPUTE_FEATURES + MEDIAN_IMPUTE_FEATURES), "Partition mismatch!"
    
    # Check category sum
    cat_sum = sum(len(v) for v in FEATURE_CATEGORIES.values())
    assert cat_sum == 27, f"Expected 27 features across categories, got {cat_sum}"
    print("  [PASS] 27 features cleanly partitioned into 5 categories, 21 zero-impute, 6 median-impute.")


def test_dataset_loading():
    """Verify synthetic dataset loads and has expected dimensions."""
    print("Test 2: Dataset Loading...")
    dataset_path = PROJECT_ROOT / "recommendation" / "data" / "synthetic" / "synthetic_training_dataset.csv"
    df = load_dataset(dataset_path)
    assert len(df) == 5908, f"Expected 5908 rows, got {len(df)}"
    assert len(df.columns) == 32, f"Expected 32 columns in CSV, got {len(df.columns)}"
    print(f"  [PASS] Successfully loaded {len(df)} rows and {len(df.columns)} columns.")


def test_split_and_metadata_exclusion():
    """Verify metadata and target are completely excluded from X."""
    print("Test 3: Metadata & Target Separation...")
    dataset_path = PROJECT_ROOT / "recommendation" / "data" / "synthetic" / "synthetic_training_dataset.csv"
    df = load_dataset(dataset_path)
    X_raw, y, metadata = split_features_target(df, is_training=True)

    assert X_raw.shape == (5908, 27), f"X_raw shape mismatch: {X_raw.shape}"
    assert y is not None and len(y) == 5908, f"y shape mismatch: {len(y) if y is not None else 'None'}"
    assert metadata.shape == (5908, 4), f"metadata shape mismatch: {metadata.shape}"

    for meta_col in METADATA_COLUMNS:
        assert meta_col not in X_raw.columns, f"Metadata column '{meta_col}' leaked into X_raw!"
    assert TARGET_COLUMN not in X_raw.columns, f"Target column '{TARGET_COLUMN}' leaked into X_raw!"
    print("  [PASS] Metadata (4 columns) and target completely excluded from feature matrix X.")


def test_fit_transform_pipeline():
    """Verify pipeline fit_transform on synthetic dataset."""
    print("Test 4: Pipeline Fit & Transform...")
    dataset_path = PROJECT_ROOT / "recommendation" / "data" / "synthetic" / "synthetic_training_dataset.csv"
    df = load_dataset(dataset_path)
    X, y, metadata, preprocessor = prepare_features(df, fit=True, is_training=True)

    assert list(X.columns) == FEATURE_COLUMNS, "Transformed columns do not match FEATURE_COLUMNS in order!"
    assert X.isnull().sum().sum() == 0, "Transformed X contains NaNs!"
    assert not np.isinf(X.to_numpy()).any(), "Transformed X contains infinite values!"
    assert len(X) == len(y), "Row count mismatch between X and y!"
    print("  [PASS] fit_transform produced clean (5908, 27) matrix with zero NaNs and exact column ordering.")


def test_missing_value_imputation():
    """Verify zero and median imputation on artificially injected NaNs."""
    print("Test 5: Missing Value Imputation Strategy...")
    dataset_path = PROJECT_ROOT / "recommendation" / "data" / "synthetic" / "synthetic_training_dataset.csv"
    df = load_dataset(dataset_path)
    _, _, _, preprocessor = prepare_features(df, fit=True, is_training=True)

    # Compute expected medians from df
    expected_acc_age_median = df["user_account_age_days"].median()
    expected_file_size_median = df["note_file_size_kb"].median()

    # Create test sample with NaNs
    test_df = df.iloc[:5].copy()
    test_df.loc[0, "user_total_views"] = np.nan       # zero-impute feature
    test_df.loc[0, "user_account_age_days"] = np.nan   # median-impute feature
    test_df.loc[1, "is_same_college"] = np.nan         # zero-impute feature
    test_df.loc[1, "note_file_size_kb"] = np.nan       # median-impute feature

    X_trans, _, _, _ = prepare_features(test_df, preprocessor=preprocessor, fit=False, is_training=True)

    assert X_trans.loc[0, "user_total_views"] == 0.0, "user_total_views not zero-imputed!"
    assert np.isclose(X_trans.loc[0, "user_account_age_days"], expected_acc_age_median), "user_account_age_days not median-imputed!"
    assert X_trans.loc[1, "is_same_college"] == 0.0, "is_same_college not zero-imputed!"
    assert np.isclose(X_trans.loc[1, "note_file_size_kb"], expected_file_size_median), "note_file_size_kb not median-imputed!"
    assert X_trans.isnull().sum().sum() == 0, "Test transform produced residual NaNs!"
    print("  [PASS] Missing values correctly imputed (zero for behavioral/affinity, median for physical/demographic).")


def test_live_inference_mode():
    """Verify live inference mode without target or interaction_source."""
    print("Test 6: Live Recommendation Inference Simulation...")
    dataset_path = PROJECT_ROOT / "recommendation" / "data" / "synthetic" / "synthetic_training_dataset.csv"
    df = load_dataset(dataset_path)
    _, _, _, preprocessor = prepare_features(df, fit=True, is_training=True)

    # Simulate live candidate notes arriving from API: only features + user_id/note_id (no target, no source)
    candidate_df = df.iloc[:30].copy().drop(columns=[TARGET_COLUMN, "interaction_source"])
    X_live, y_live, meta_live, _ = prepare_features(
        candidate_df, preprocessor=preprocessor, fit=False, is_training=False
    )

    assert y_live is None, "Live inference should return None for y"
    assert X_live.shape == (30, 27), f"Expected shape (30, 27), got {X_live.shape}"
    assert list(X_live.columns) == FEATURE_COLUMNS, "Live inference column order mismatch!"
    assert "user_id" in meta_live.columns and "note_id" in meta_live.columns, "Metadata missing IDs!"
    print("  [PASS] Live inference mode safely transforms candidate notes without requiring target labels.")


def test_real_dataset_compatibility():
    """Verify pipeline works on the real PostgreSQL extracted dataset."""
    print("Test 7: Real Extracted Dataset Compatibility...")
    real_path = PROJECT_ROOT / "recommendation" / "data" / "processed" / "training_dataset.csv"
    df_real = load_dataset(real_path)
    X_real, y_real, meta_real, _ = prepare_features(df_real, fit=True, is_training=True)

    assert X_real.shape == (len(df_real), 27), f"Real dataset X shape mismatch: {X_real.shape}"
    assert len(y_real) == len(df_real), "Real dataset y length mismatch!"
    print(f"  [PASS] Real dataset ({len(df_real)} rows) processed with identical 27-feature pipeline.")


def test_validation_error_handling():
    """Verify validation functions catch malformed inputs."""
    print("Test 8: Error Handling and Validation Guards...")
    # Missing column
    bad_df = pd.DataFrame({"is_same_college": [1], "target": [1]})
    try:
        validate_dataset(bad_df, is_training=True)
        assert False, "Should have raised ValueError for missing columns"
    except ValueError:
        pass

    # Invalid target
    dataset_path = PROJECT_ROOT / "recommendation" / "data" / "synthetic" / "synthetic_training_dataset.csv"
    df = load_dataset(dataset_path).iloc[:10].copy()
    df.loc[0, "target"] = 5
    try:
        validate_dataset(df, is_training=True)
        assert False, "Should have raised ValueError for invalid target"
    except ValueError:
        pass

    print("  [PASS] Validation guards properly reject malformed datasets.")


def run_all_tests():
    print("=" * 60)
    print("RUNNING FEATURE PIPELINE TEST SUITE")
    print("=" * 60)
    test_constants_and_partitions()
    test_dataset_loading()
    test_split_and_metadata_exclusion()
    test_fit_transform_pipeline()
    test_missing_value_imputation()
    test_live_inference_mode()
    test_real_dataset_compatibility()
    test_validation_error_handling()
    print("=" * 60)
    print("ALL 8 FEATURE PIPELINE TESTS PASSED!")
    print("=" * 60)


if __name__ == "__main__":
    run_all_tests()
