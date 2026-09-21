from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RESULTS = ROOT / "results"
(RESULTS / "tables").mkdir(parents=True, exist_ok=True)
(RESULTS / "figures").mkdir(parents=True, exist_ok=True)


def main() -> None:
    print("DSH Research project is ready.")
    print(f"Project root: {ROOT}")


if __name__ == "__main__":
    main()
