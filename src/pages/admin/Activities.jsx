import { useEffect, useState } from "react";
import { UserPlus, PenSquare, FileText, Users, Filter } from "lucide-react";
import { Card, PageHeading, Select } from "../../components/ui";
import { getActivities } from "../../utils/api";

const iconByType = {
  Student: UserPlus,
  Marks: PenSquare,
  "Report Card": FileText,
  Class: Users,
};

const toneByType = {
  Student: "bg-[#1e3a8a] text-white",
  Marks: "bg-[#0ea5e9] text-white",
  "Report Card": "bg-[#10b981] text-white",
  Class: "bg-slate-300 text-slate-700",
};

const types = ["All", "Student", "Marks", "Report Card", "Class"];

function relativeTime(timestamp) {
  const diffMs = Date.now() - timestamp;
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return "Just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} minute${diffMin === 1 ? "" : "s"} ago`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour} hour${diffHour === 1 ? "" : "s"} ago`;
  const diffDay = Math.floor(diffHour / 24);
  if (diffDay === 1) return "Yesterday";
  if (diffDay < 7) return `${diffDay} days ago`;
  const diffWeek = Math.floor(diffDay / 7);
  if (diffWeek < 5) return `${diffWeek} week${diffWeek === 1 ? "" : "s"} ago`;
  return new Date(timestamp).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

export default function Activities() {
  const [activities, setActivities] = useState([]);
  const [filter, setFilter] = useState("All");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getActivities()
      .then(setActivities)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const filtered =
    filter === "All" ? activities : activities.filter((a) => a.type === filter);

  return (
    <>
      <PageHeading
        title="Activities"
        subtitle="A complete log of actions taken across the system."
        action={
          <div className="flex items-center gap-2">
            <Filter size={15} className="text-slate-400" />
            <Select
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="w-40"
            >
              {types.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </Select>
          </div>
        }
      />

      {error && <p className="mb-4 text-sm text-rose-500">{error}</p>}

      <Card>
        {loading ? (
          <p className="py-6 text-center text-sm text-slate-400">
            Loading activity…
          </p>
        ) : (
          <ol className="relative flex flex-col gap-6 border-l-2 border-dashed border-[#e2e8f0] pl-6">
            {filtered.map((activity, i) => {
              const Icon = iconByType[activity.type] || FileText;
              return (
                <li key={i} className="relative">
                  <span
                    className={`absolute -left-[31px] flex h-7 w-7 items-center justify-center rounded-full ring-4 ring-white ${
                      toneByType[activity.type] || "bg-slate-300 text-slate-700"
                    }`}
                  >
                    <Icon size={13} />
                  </span>
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm text-[#1e293b]">{activity.text}</p>
                    <span className="rounded-full bg-[#f1f5f9] px-2 py-0.5 text-[11px] font-medium text-slate-500">
                      {activity.type}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-slate-400">
                    {relativeTime(activity.timestamp)}
                  </p>
                </li>
              );
            })}

            {filtered.length === 0 && (
              <li className="py-6 text-sm text-slate-400">
                No activity found for this filter.
              </li>
            )}
          </ol>
        )}
      </Card>
    </>
  );
}
