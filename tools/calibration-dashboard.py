#!/usr/bin/env python3
"""
Kalshi calibration dashboard data generator.
Reads shadow logs and calibration artifacts, produces JSON data + chart images.
"""
import json
import sys
from pathlib import Path
from datetime import datetime, timezone

# Add daimon_runtime path for setup_plot
runtime_root = Path(sys.executable).parent.parent.parent
sys.path.insert(0, str(runtime_root))


def run(ctx=None):
    """Blueprint Automation entrypoint."""
    result = main(ctx)
    return {"artifact": result}
    """Blueprint Automation entrypoint."""
    return main(ctx)


def main(ctx=None):
    """Generate calibration dashboard data and charts."""
    """Generate calibration dashboard data and charts."""
    from daimon_runtime import setup_plot
    import pandas as pd
    import seaborn as sns
    import matplotlib.pyplot as plt

    # Determine output directory
    if ctx:
        out_dir = Path(ctx.get("runDir", "."))
        setup_plot(ctx)
    else:
        out_dir = Path("/Users/nolarose/Projects/Kalshi-bot/research/calibration-dashboard")
        out_dir.mkdir(parents=True, exist_ok=True)
        setup_plot()
    if ctx:
        out_dir = Path(ctx.get("runDir", "."))
        setup_plot(ctx)
    else:
        out_dir = Path(".")
        setup_plot()

    root = Path("/Users/nolarose/Projects/Kalshi-bot")
    alpha_dir = root / "alpha"

    # ── Collect all programs ──
    programs = []
    for prog_dir in sorted(alpha_dir.iterdir()):
        if not prog_dir.is_dir():
            continue
        manifest_path = prog_dir / "program.json"
        if not manifest_path.exists():
            continue
        manifest = json.loads(manifest_path.read_text())
        shadow_log = prog_dir / manifest.get("shadowLog", "shadow-log.jsonl")
        entries = []
        if shadow_log.exists():
            for line in shadow_log.read_text().strip().split("\n"):
                line = line.strip()
                if line:
                    entries.append(json.loads(line))
        programs.append({
            "name": manifest["name"],
            "status": manifest["status"],
            "role": manifest.get("role", "alpha"),
            "baseline": manifest.get("baseline", "none"),
            "gates": manifest.get("gates", {}),
            "entries": entries,
        })

    # ── Per-program metrics ──
    dashboard = {
        "programs": [],
        "generatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
    }

    chart_paths = []

    for prog in programs:
        entries = prog["entries"]
        name = prog["name"]

        # Separate entry kinds
        predictions = [e for e in entries if e.get("kind") in (None, "prediction")]
        toxicity_marks = [e for e in entries if e.get("kind") == "toxicity-mark"]
        outcomes = [e for e in entries if e.get("kind") == "outcome-resolution"]

        # Materialize: join toxicity + outcome onto predictions
        tox_by_ref = {e["refLineHash"]: e for e in toxicity_marks}
        out_by_event = {e["eventId"]: e["outcome"] for e in outcomes}

        trade_preds = []
        edge_values = []
        brier_values = []
        timeline = []

        for p in predictions:
            # Decision stats
            if p["decision"]["action"] == "trade":
                trade_preds.append(p)
                # Realized edge (cents per contract after fees)
                if p.get("vwapFillCents") is not None and p.get("filledContracts", 0) > 0:
                    side = p["decision"].get("side", "yes")
                    fee = p.get("feePerContractCents", 0)
                    vwap = p["vwapFillCents"]
                    p_model = p["pModel"]
                    if side == "yes":
                        edge = p_model * 100 - vwap - fee
                    else:
                        edge = (1 - p_model) * 100 - (100 - vwap) - fee
                    edge_values.append(edge)

            # Timeline entry
            ts = p["ts"]
            dt = datetime.fromtimestamp(ts / 1000, tz=timezone.utc)
            timeline.append({
                "ts": ts,
                "datetime": dt.isoformat(),
                "action": p["decision"]["action"],
                "reason": p["decision"].get("reason", ""),
                "pModel": p["pModel"],
                "rawEdgeCents": p.get("rawEdgeCents"),
                "ticker": p["ticker"],
                "eventId": p["eventId"],
            })

            # Resolved outcome → Brier contribution
            outcome = out_by_event.get(p["eventId"])
            if outcome is not None:
                brier = (p["pModel"] - outcome) ** 2
                brier_values.append({
                    "ts": ts,
                    "datetime": datetime.fromtimestamp(ts / 1000, tz=timezone.utc).isoformat(),
                    "brier": brier,
                    "outcome": outcome,
                    "pModel": p["pModel"],
                    "ticker": p["ticker"],
                })

        # Toxicity stats
        tox_against = sum(1 for t in toxicity_marks if t.get("movedAgainst"))
        tox_total = len(toxicity_marks)

        # Metrics
        total = len(predictions)
        trades = len(trade_preds)
        skips = total - trades
        resolved_count = len(brier_values)
        brier = sum(v["brier"] for v in brier_values) / resolved_count if resolved_count else None
        distinct_events = len(set(p["eventId"] for p in predictions))
        mean_edge = sum(edge_values) / len(edge_values) if edge_values else None

        prog_dashboard = {
            "name": name,
            "status": prog["status"],
            "role": prog["role"],
            "baseline": prog["baseline"],
            "totalSignals": total,
            "trades": trades,
            "skips": skips,
            "resolved": resolved_count,
            "distinctEvents": distinct_events,
            "brier": round(brier, 6) if brier is not None else None,
            "meanEdgeCents": round(mean_edge, 4) if mean_edge is not None else None,
            "toxicityMarked": tox_total,
            "toxicityAgainst": tox_against,
            "toxicityRate": round(tox_against / tox_total, 3) if tox_total else None,
            "gates": prog["gates"],
        }
        dashboard["programs"].append(prog_dashboard)

        # ── Per-program charts ──
        if not predictions:
            continue

        df_timeline = pd.DataFrame(timeline)
        if len(df_timeline) > 0:
            df_timeline["datetime"] = pd.to_datetime(df_timeline["datetime"])
            fig, axes = plt.subplots(2, 2, figsize=(14, 10))

            # Top-left: Action count over time
            ax = axes[0, 0]
            df_timeline["date"] = df_timeline["datetime"].dt.date
            action_counts = df_timeline.groupby(["date", "action"]).size().unstack(fill_value=0)
            if "trade" in action_counts.columns:
                action_counts["trade"].plot(kind="bar", ax=ax, color="#2ecc71", alpha=0.8, label="trade")
            if "skip" in action_counts.columns:
                action_counts["skip"].plot(
                    kind="bar", ax=ax, color="#e74c3c", alpha=0.8, label="skip",
                    bottom=action_counts.get("trade", 0),
                )
            ax.set_title(f"{name} — Daily Actions", fontsize=11)
            ax.set_xlabel("Date")
            ax.set_ylabel("Count")
            ax.legend()
            ax.tick_params(axis="x", rotation=45)

            # Top-right: pModel distribution
            ax = axes[0, 1]
            sns.histplot(
                data=df_timeline, x="pModel", hue="action", bins=20, ax=ax,
                palette={"trade": "#2ecc71", "skip": "#e74c3c"}, alpha=0.7,
            )
            ax.set_title("Model Probability Distribution", fontsize=11)
            ax.set_xlabel("pModel")
            ax.set_ylabel("Count")

            # Bottom-left: Brier score over time (if resolved)
            ax = axes[1, 0]
            if brier_values:
                df_brier = pd.DataFrame(brier_values)
                df_brier["datetime"] = pd.to_datetime(df_brier["datetime"])
                df_brier = df_brier.sort_values("datetime")
                df_brier["cumulative_brier"] = df_brier["brier"].expanding().mean()
                sns.lineplot(data=df_brier, x="datetime", y="cumulative_brier", ax=ax, color="#3498db")
                ax.axhline(0.25, color="gray", linestyle="--", label="coin-flip baseline")
                ax.set_title("Cumulative Brier Score", fontsize=11)
                ax.set_xlabel("Date")
                ax.set_ylabel("Brier")
                ax.legend()
                ax.tick_params(axis="x", rotation=45)
            else:
                ax.text(0.5, 0.5, "No resolved outcomes yet", ha="center", va="center", transform=ax.transAxes)
                ax.set_title("Cumulative Brier Score", fontsize=11)

            # Bottom-right: Realized edge distribution
            ax = axes[1, 1]
            if edge_values:
                sns.histplot(edge_values, bins=15, kde=True, ax=ax, color="#9b59b6")
                ax.axvline(0, color="red", linestyle="--", label="break-even")
                gates = prog.get("gates", {})
                grad_edge = gates.get("graduationMinRealizedEdgeCentsPerFill")
                if grad_edge is not None:
                    ax.axvline(grad_edge, color="green", linestyle="--", label=f"grad gate ({grad_edge}c)")
                ax.set_title("Realized Edge (cents / contract)", fontsize=11)
                ax.set_xlabel("Edge (cents)")
                ax.set_ylabel("Count")
                ax.legend()
            else:
                ax.text(0.5, 0.5, "No fills yet", ha="center", va="center", transform=ax.transAxes)
                ax.set_title("Realized Edge", fontsize=11)

            fig.suptitle(f"Calibration Dashboard: {name}", fontsize=13, fontweight="bold")
            plt.tight_layout(rect=[0, 0.03, 1, 0.95])
            chart_path = out_dir / f"{name}-calibration.png"
            fig.savefig(chart_path, dpi=180, bbox_inches="tight")
            plt.close(fig)
            chart_paths.append(str(chart_path))

    # ── Summary comparison chart ──
    if len(programs) > 1:
        df_summary = pd.DataFrame(dashboard["programs"])
        fig, axes = plt.subplots(1, 3, figsize=(15, 5))

        # Brier comparison
        ax = axes[0]
        brier_data = df_summary[df_summary["brier"].notna()]
        if len(brier_data):
            colors = ["#3498db" if r == "baseline" else "#2ecc71" for r in brier_data["role"]]
            ax.barh(brier_data["name"], brier_data["brier"], color=colors)
            ax.axvline(0.25, color="gray", linestyle="--", label="coin-flip")
            ax.set_xlabel("Brier Score")
            ax.set_title("Brier Score (lower = better)")
            ax.legend()
        else:
            ax.text(0.5, 0.5, "No resolved outcomes", ha="center", va="center", transform=ax.transAxes)

        # Trade ratio
        ax = axes[1]
        df_summary["tradeRatio"] = df_summary["trades"] / df_summary["totalSignals"].replace(0, 1)
        ax.barh(df_summary["name"], df_summary["tradeRatio"], color="#9b59b6")
        ax.set_xlabel("Trade Ratio")
        ax.set_title("Trade vs Skip Ratio")
        ax.set_xlim(0, 1)

        # Mean edge
        ax = axes[2]
        edge_data = df_summary[df_summary["meanEdgeCents"].notna()]
        if len(edge_data):
            ax.barh(edge_data["name"], edge_data["meanEdgeCents"], color="#f39c12")
            ax.axvline(0, color="red", linestyle="--")
            ax.set_xlabel("Mean Edge (cents)")
            ax.set_title("Realized Edge / Fill")
        else:
            ax.text(0.5, 0.5, "No fills", ha="center", va="center", transform=ax.transAxes)

        fig.suptitle("Program Comparison", fontsize=13, fontweight="bold")
        plt.tight_layout(rect=[0, 0.03, 1, 0.95])
        summary_path = out_dir / "program-comparison.png"
        fig.savefig(summary_path, dpi=180, bbox_inches="tight")
        plt.close(fig)
        chart_paths.append(str(summary_path))

    # Save JSON data
    data_path = out_dir / "dashboard-data.json"
    data_path.write_text(json.dumps(dashboard, indent=2, default=str))

    return {
        "dashboard": dashboard,
        "chartPaths": chart_paths,
        "dataPath": str(data_path),
    }


if __name__ == "__main__":
    result = main()
    print(json.dumps(result, indent=2, default=str))
