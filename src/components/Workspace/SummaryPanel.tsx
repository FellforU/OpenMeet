import { useTranslation } from "react-i18next";
import { Lightbulb, CheckCircle, User, Calendar, Loader2, MessageSquare } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { Badge } from "../ui/badge";
import { useTranscriptionStore } from "../../stores/transcriptionStore";

interface ActionItem {
  action?: string;
  task?: string;
  assignee?: string;
  owner?: string;
  deadline?: string | null;
}

export function SummaryPanel() {
  const { t } = useTranslation("workspace");
  const summary = useTranscriptionStore((s) => s.summary);
  const status = useTranscriptionStore((s) => s.job.status);
  const pipelineStep = useTranscriptionStore((s) => s.job.pipelineStep);

  if (status === "post_processing" && pipelineStep === "summarizing") {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
        <Loader2 className="h-8 w-8 animate-spin" />
        <p className="text-sm">{t("summary.generating")}</p>
      </div>
    );
  }

  if (!summary) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
        <Lightbulb className="h-10 w-10" />
        <p className="text-sm">{t("summary.empty")}</p>
      </div>
    );
  }

  // Handle raw response (non-JSON fallback)
  if ("raw" in summary && typeof (summary as Record<string, unknown>).raw === "string") {
    return (
      <div className="h-full overflow-y-auto p-4">
        <Card>
          <CardContent className="pt-6">
            <p className="whitespace-pre-wrap">{(summary as Record<string, unknown>).raw as string}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const topic = summary.topic || "";
  const conclusions = summary.conclusions || [];
  const actionItems: ActionItem[] = summary.actionItems || [];
  const discussion =
    typeof summary.discussion === "string" ? summary.discussion : "";

  return (
    <div className="h-full space-y-3 overflow-y-auto p-4">
      {topic && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Lightbulb className="h-4 w-4" />
              {t("summary.topic")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <h3 className="text-lg font-semibold">{topic}</h3>
          </CardContent>
        </Card>
      )}

      {conclusions.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <CheckCircle className="h-4 w-4" />
              {t("summary.conclusions")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1">
              {conclusions.map((item: string, i: number) => (
                <li key={i}>
                  <Badge variant="secondary">{item}</Badge>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {actionItems.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <User className="h-4 w-4" />
              {t("summary.actionItems")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {actionItems.map((item: ActionItem, i: number) => (
                <li key={i}>
                  <p>{item.action || item.task}</p>
                  <div className="mt-1 flex gap-1.5">
                    {(item.owner || item.assignee) && (
                      <Badge variant="outline" className="gap-1 text-[10px]">
                        <User className="h-2.5 w-2.5" />
                        {item.owner || item.assignee}
                      </Badge>
                    )}
                    {item.deadline && (
                      <Badge variant="outline" className="gap-1 text-[10px]">
                        <Calendar className="h-2.5 w-2.5" />
                        {item.deadline}
                      </Badge>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {discussion && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <MessageSquare className="h-4 w-4" />
              {t("summary.discussion")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="whitespace-pre-wrap">{discussion}</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
