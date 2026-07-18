import React from "react";


export const focusRing =
  "focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0ea5e9] focus-visible:ring-offset-2";

export function Card({ children, className = "" }) {
  return (
    <section
      className={`rounded-2xl border border-[#e2e8f0] bg-white p-6 shadow-sm transition-shadow hover:shadow-md ${className}`}
    >
      {children}
    </section>
  );
}

export function CardHeader({ title, subtitle, action }) {
  return (
    <div className="mb-4 flex items-start justify-between gap-4">
      <div>
        <h3 className="text-lg font-bold tracking-tight text-[#1e3a8a]">
          {title}
        </h3>
        {subtitle && (
          <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p>
        )}
      </div>
      {action}
    </div>
  );
}

export function PageHeading({ title, subtitle, action }) {
  return (
    <div className="mb-6 flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-[#1e3a8a]">
          {title}
        </h1>
        {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

const buttonVariants = {
  primary:
    "bg-[#10b981] text-white hover:bg-[#0ea371] shadow-sm hover:shadow",
  accent: "bg-[#0ea5e9] text-white hover:bg-[#0b93d1] shadow-sm hover:shadow",
  outline:
    "border border-[#e2e8f0] text-[#1e3a8a] bg-white hover:bg-[#f1f5f9]",
  ghost: "text-[#1e3a8a] hover:bg-[#f1f5f9]",
  danger: "bg-rose-500 text-white hover:bg-rose-600",
};

export function Button({
  children,
  variant = "primary",
  icon: Icon,
  className = "",
  ...props
}) {
  return (
    <button
      className={`inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold transition-all duration-150 active:scale-[0.98] ${focusRing} ${buttonVariants[variant]} ${className}`}
      {...props}
    >
      {Icon && <Icon size={16} />}
      {children}
    </button>
  );
}

export function Badge({ children, tone = "slate" }) {
  const tones = {
    slate: "bg-slate-100 text-slate-600",
    sky: "bg-[#0ea5e9]/10 text-[#0ea5e9]",
    emerald: "bg-[#10b981]/10 text-[#10b981]",
    amber: "bg-amber-100 text-amber-700",
    rose: "bg-rose-100 text-rose-600",
    navy: "bg-[#1e3a8a]/10 text-[#1e3a8a]",
  };
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

export function Label({ children, htmlFor }) {
  return (
    <label
      htmlFor={htmlFor}
      className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500"
    >
      {children}
    </label>
  );
}

export function Input(props) {
  return (
    <input
      {...props}
      className={`w-full rounded-lg border border-[#e2e8f0] bg-white px-3.5 py-2.5 text-sm text-slate-700 placeholder:text-slate-400 transition-colors focus:border-[#0ea5e9] focus:outline-none focus:ring-2 focus:ring-[#0ea5e9]/15 ${
        props.className || ""
      }`}
    />
  );
}

export function Select({ children, ...props }) {
  return (
    <select
      {...props}
      className={`w-full rounded-lg border border-[#e2e8f0] bg-white px-3.5 py-2.5 text-sm text-slate-700 transition-colors focus:border-[#0ea5e9] focus:outline-none focus:ring-2 focus:ring-[#0ea5e9]/15 ${
        props.className || ""
      }`}
    >
      {children}
    </select>
  );
}

export function Table({ columns, children }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-[#e2e8f0]">
      <table className="w-full min-w-[560px] text-left text-sm">
        <thead>
          <tr className="border-b border-[#e2e8f0] bg-[#f1f5f9]">
            {columns.map((col) => (
              <th
                key={col}
                className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500"
              >
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-[#e2e8f0]">{children}</tbody>
      </table>
    </div>
  );
}

export function EmptyState({ icon: Icon, title, subtitle, action }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-[#e2e8f0] py-12 text-center">
      {Icon && (
        <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-[#f1f5f9] text-slate-400">
          <Icon size={22} />
        </div>
      )}
      <p className="font-semibold text-[#1e3a8a]">{title}</p>
      {subtitle && (
        <p className="mt-1 max-w-xs text-sm text-slate-500">{subtitle}</p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
