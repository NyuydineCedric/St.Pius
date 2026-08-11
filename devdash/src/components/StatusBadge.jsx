export default function StatusBadge({ state }) {
  const cls =
    state === "ACTIVE"
      ? "badge-active"
      : state === "EXPIRING"
        ? "badge-expiring"
        : state === "EXPIRED"
          ? "badge-expired"
          : "badge-revoked";
  return <span className={`badge ${cls}`}>{state}</span>;
}
