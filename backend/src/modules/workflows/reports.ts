import { Request, Response, Router } from "express";
import { prisma } from "../../infra/prisma.js";
import { getChatbot } from "../chatbots/service.js";

// Saved AI build reports (draw.io verification), one list per bot.
// Mounted inside workflowsRouter, so auth is already required.

export async function saveReport(opts: {
  chatbotId: string;
  userId?: string | null;
  title: string;
  report: { status: string } & Record<string, unknown>;
}) {
  const user = opts.userId
    ? await prisma.user.findUnique({ where: { id: opts.userId }, select: { email: true } })
    : null;
  return prisma.aiReport.create({
    data: {
      chatbotId: opts.chatbotId,
      title: opts.title.slice(0, 200),
      status: String(opts.report.status ?? "not_tested"),
      report: opts.report as any,
      createdById: opts.userId ?? null,
      createdByEmail: user?.email ?? null,
    },
    select: { id: true, title: true, status: true, createdAt: true, createdByEmail: true },
  });
}

export const reportsRouter = Router({ mergeParams: true });

// GET api/chatbots/:chatbotId/workflow/reports — list (no report bodies)
reportsRouter.get("/", async (req: Request, res: Response) => {
  const { chatbotId } = req.params;
  if (!(await getChatbot(chatbotId))) return res.status(404).json({ error: "Chatbot not found" });
  const reports = await prisma.aiReport.findMany({
    where: { chatbotId },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: { id: true, title: true, status: true, createdAt: true, createdByEmail: true },
  });
  res.json({ reports });
});

// GET api/chatbots/:chatbotId/workflow/reports/:reportId — full report
reportsRouter.get("/:reportId", async (req: Request, res: Response) => {
  const { chatbotId, reportId } = req.params;
  const report = await prisma.aiReport.findFirst({ where: { id: reportId, chatbotId } });
  if (!report) return res.status(404).json({ error: "Report not found" });
  res.json(report);
});

// DELETE api/chatbots/:chatbotId/workflow/reports/:reportId
reportsRouter.delete("/:reportId", async (req: Request, res: Response) => {
  const { chatbotId, reportId } = req.params;
  const { count } = await prisma.aiReport.deleteMany({ where: { id: reportId, chatbotId } });
  if (!count) return res.status(404).json({ error: "Report not found" });
  res.status(204).end();
});
