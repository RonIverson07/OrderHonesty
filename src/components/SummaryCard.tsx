interface SummaryCardProps {
  title: string;
  value: string;
  subtitle?: string;
  icon: React.ReactNode;
  trend?: "up" | "down" | "neutral";
}

export default function SummaryCard({
  title,
  value,
  subtitle,
  icon,
  trend,
}: SummaryCardProps) {
  return (
    <div className="card p-5 animate-slide-in">
      <div className="flex items-start justify-between mb-3">
        <span className="text-2xl">{icon}</span>
        {trend && (
          <span
            className={`text-xs font-medium px-2 py-0.5 rounded-full ${
              trend === "up"
                ? "bg-emerald-50 text-emerald-700"
                : trend === "down"
                ? "bg-red-50 text-red-700"
                : "bg-gray-100 text-gray-500"
            }`}
          >
            {trend === "up" ? "↑" : trend === "down" ? "↓" : "—"} Today
          </span>
        )}
      </div>
      <p className="text-sm text-gray-500 mb-1">{title}</p>
      <p className="text-2xl font-bold text-gray-900">{value}</p>
      {subtitle && (
        <p className="text-xs text-gray-400 mt-1">{subtitle}</p>
      )}
    </div>
  );
}
