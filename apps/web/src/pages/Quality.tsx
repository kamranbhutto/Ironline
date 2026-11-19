/**
 * Quality overview: readings this week, every out-of-tolerance reading, the jobs being inspected
 * and the parts that have an inspection plan.
 */
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { api } from "../api.ts";
import { nominalText, targetText } from "../components/InspectionPlan.tsx";
import { ErrorNote, Loading, MetricCard, PageHeader, R, Status, Table, TabPanel, Td } from "../components/ui.tsx";
import { date, num } from "../format.ts";

interface Overview {
  plans: { itemId: string; partNumber: string; revision: string; description: string; balloons: number; critical: number }[];
  counts: { week: number; weekFailed: number; total: number; totalFailed: number };
  failures: {
    id: string;
    jobId: string;
    jobNumber: string;
    number: number;
    kind: string;
    nominal: number | null;
    tolPlus: number | null;
    tolMinus: number | null;
    unit: string;
    requirement: string | null;
    piece: number;
    value: number | null;
    recordedAt: string;
    userName: string | null;
    lower: number | null;
    upper: number | null;
  }[];
  active: { jobId: string; jobNumber: string; description: string; status: string; quantity: number; balloons: number; readings: number; failed: number }[];
}

export function QualityPage() {
  const q = useQuery({ queryKey: ["quality-overview"], queryFn: () => api<Overview>("/quality/overview"), refetchInterval: 30_000 });
  if (q.error) return <ErrorNote error={q.error} />;
  if (!q.data) return <Loading />;
  const { counts, failures, active, plans } = q.data;
  const firstPass = counts.total ? ((counts.total - counts.totalFailed) / counts.total) * 100 : null;

  return (
    <div className="space-y-5">
      <PageHeader title="Quality" sub="Inspection plans on parts, readings from the floor, and anything out of tolerance." />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Readings this week" value={num(counts.week)} note={`${num(counts.total)} recorded in all`} tone="accent" />
        <MetricCard label="Out of tolerance this week" value={num(counts.weekFailed)} note={counts.weekFailed ? "See the list below" : "Nothing out of tolerance"} tone={counts.weekFailed ? "bad" : "ok"} />
        <MetricCard label="Readings in tolerance" value={firstPass == null ? "—" : `${num(firstPass, 1)}%`} note="All readings so far" tone={firstPass == null ? "line" : firstPass >= 98 ? "ok" : "warn"} />
        <MetricCard label="Parts with a plan" value={num(plans.length)} note={`${num(plans.reduce((a, p) => a + p.balloons, 0))} balloons in all`} tone="line" />
      </div>

      <TabPanel title="Out of tolerance">
        <Table head={["Job", "Balloon", "Requirement", "Limits", R("Piece"), R("Reading"), "By", "When"]} empty="No out-of-tolerance readings. Good work.">
          {failures.map((f) => (
            <tr key={f.id}>
              <Td>
                <Link to={`/jobs/${f.jobId}`} className="font-medium text-accent hover:underline">
                  {f.jobNumber}
                </Link>
              </Td>
              <Td className="num">{f.number}</Td>
              <Td>{f.kind === "note" ? f.requirement : targetText({ ...f, datums: null })}</Td>
              <Td className="num text-muted">
                {f.kind === "note" ? "Pass / fail" : `${f.lower == null ? "no min" : nominalText({ ...f, nominal: f.lower })} – ${f.upper == null ? "no max" : nominalText({ ...f, nominal: f.upper })}`}
              </Td>
              <Td right>{f.piece}</Td>
              <Td right className="font-semibold text-bad">{f.value ?? "Fail"}</Td>
              <Td className="text-muted">{f.userName ?? "—"}</Td>
              <Td className="text-muted">{date(f.recordedAt)}</Td>
            </tr>
          ))}
        </Table>
      </TabPanel>

      <div className="grid gap-5 xl:grid-cols-2">
        <TabPanel title="Jobs being inspected">
          <Table head={["Job", "Status", R("Balloons"), R("Readings"), R("Out of tol.")]} empty="No open jobs have an inspection plan yet.">
            {active.map((a) => (
              <tr key={a.jobId}>
                <Td>
                  <Link to={`/jobs/${a.jobId}`} className="font-medium text-accent hover:underline">
                    {a.jobNumber}
                  </Link>
                  <div className="max-w-48 truncate text-xs text-muted">{a.description}</div>
                </Td>
                <Td>
                  <Status value={a.status} />
                </Td>
                <Td right>{a.balloons}</Td>
                <Td right>{a.readings}</Td>
                <Td right className={a.failed ? "font-semibold text-bad" : "text-muted"}>{a.failed}</Td>
              </tr>
            ))}
          </Table>
        </TabPanel>
        <TabPanel title="Parts with an inspection plan">
          <Table head={["Part", R("Balloons"), R("Critical")]} empty="No plans yet. Open a part and add balloons to its drawing under Inspection plan.">
            {plans.map((p) => (
              <tr key={p.itemId}>
                <Td>
                  <Link to={`/items/${p.itemId}`} className="font-medium text-accent hover:underline">
                    {p.partNumber} rev {p.revision}
                  </Link>
                  <div className="max-w-72 truncate text-xs text-muted">{p.description}</div>
                </Td>
                <Td right>{p.balloons}</Td>
                <Td right>{p.critical || "—"}</Td>
              </tr>
            ))}
          </Table>
        </TabPanel>
      </div>
    </div>
  );
}
