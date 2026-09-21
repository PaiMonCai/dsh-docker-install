"""Economics Research Pack starter.

Keep paper-producing specifications in scripts like this one and run them through
research-run so the environment, Git state, logs and output hashes are recorded.
"""

from pathlib import Path

import pandas as pd
import pyfixest as pf
from linearmodels.iv import IV2SLS

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data" / "processed"
TABLES = ROOT / "results" / "tables"
FIGURES = ROOT / "results" / "figures"

TABLES.mkdir(parents=True, exist_ok=True)
FIGURES.mkdir(parents=True, exist_ok=True)


def baseline_fixed_effects(df: pd.DataFrame):
    """Example only: replace variable names with the project's pre-specified model."""
    required = {"y", "treatment", "x1", "entity_id", "year"}
    missing = required.difference(df.columns)
    if missing:
        raise ValueError(f"Missing columns for example FE model: {sorted(missing)}")

    return pf.feols(
        "y ~ treatment + x1 | entity_id + year",
        data=df,
        vcov={"CRV1": "entity_id"},
    )


def example_iv(df: pd.DataFrame):
    """Example IV/2SLS specification. Replace with a defensible project design."""
    required = {"y", "endog", "instrument", "x1"}
    missing = required.difference(df.columns)
    if missing:
        raise ValueError(f"Missing columns for example IV model: {sorted(missing)}")

    return IV2SLS.from_formula(
        "y ~ 1 + x1 + [endog ~ instrument]",
        data=df,
    ).fit(cov_type="robust")


def main() -> None:
    print("Economics Research Pack is ready.")
    print("Define the estimand and identification strategy in research.yaml before")
    print("turning these examples into paper-producing specifications.")


if __name__ == "__main__":
    main()
