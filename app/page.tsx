"use client";

import React from "react";
import * as XLSX from "xlsx";
import { toast } from "sonner";
import { endOfDay, startOfDay, subMonths, subWeeks, subYears } from "date-fns";
import { isOperatorReply, type CrispConversation, type ConversationMessages } from "@/lib/crisp";
import { createConversationsCheckpoint, createMessagesCheckpoint, loadedMessageGroups, loadConversations, loadAllConversationMessages, type ConversationsCheckpoint, type MessagesCheckpoint } from "@/lib/crisp-loader";
import { errorMessage, fetchCrispData, type CrispCredentials } from "@/lib/crisp-client";
import { buildExport, downloadText, messageColumns, messageRows, toCsv, toWorkbook, type ExportFilters } from "@/lib/crisp-export";
import { type DateRange } from "react-day-picker"

import { Calendar } from "@/components/ui/calendar"
import { Button } from "@/components/ui/button"

const formatDate = (date?: Date) => {
  if (date) {
    return date.toLocaleDateString("uk-UA", { day: "2-digit", month: "2-digit", year: "numeric" });
  }
  return "-"
}

function readSavedSetting(key: string): string {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(key) || "";
  } catch {
    return "";
  }
}

type LoadJob =
  | { kind: "conversations"; credentials: CrispCredentials; filters: ExportFilters; checkpoint: ConversationsCheckpoint }
  | { kind: "messages"; credentials: CrispCredentials; conversations: CrispConversation[]; checkpoint: MessagesCheckpoint };

export default function Home() {
  const [loading, setLoading] = React.useState(false);
  const [loadingText, setLoadingText] = React.useState("");
  const [conversations, setConversations] = React.useState<CrispConversation[]>([]);
  const [messages, setCrispMessages] = React.useState<ConversationMessages[]>([]);
  const [messagesReady, setMessagesReady] = React.useState(false);
  const [conversationsReady, setConversationsReady] = React.useState(false);
  const [pausedLoad, setPausedLoad] = React.useState<{ kind: LoadJob["kind"]; error: string } | null>(null);
  const loadJobRef = React.useRef<LoadJob | null>(null);
  const runningRef = React.useRef(false);
  const [onlyOperatorReplies, setOnlyOperatorReplies] = React.useState(true);
  const [includeRawColumns, setIncludeRawColumns] = React.useState(false);
  const [loadedFilters, setLoadedFilters] = React.useState<ExportFilters>({
    conversation_updated_from: null,
    conversation_updated_to: null,
  });
  const messageCount = messages.reduce((count, group) => count + group.messages.length, 0);
  const exportGroups = onlyOperatorReplies
    ? messages.filter(group => group.messages.some(isOperatorReply))
    : messages;
  const exportMessageCount = exportGroups.reduce((count, group) => count + group.messages.length, 0);

  const [showSettings, setShowSettings] = React.useState(false);
  // Settings are only rendered when the modal opens, after hydration.
  const [crispIdentifier, setCrispIdentifier] = React.useState(() => readSavedSetting("CRISP_IDENTIFIER"));
  const [crispKey, setCrispKey] = React.useState(() => readSavedSetting("CRISP_KEY"));
  const [crispWebsiteId, setCrispWebsiteId] = React.useState(() => readSavedSetting("CRISP_WEBSITE_ID"));
  const [dateRange, setDateRange] = React.useState<DateRange | undefined>({
    from: subMonths(new Date(), 6),
    to: new Date(),
  });
  const [showFilters, setShowFilters] = React.useState(false);

  const quickSelect = (type: string) => {
    const now = new Date();

    switch (type) {
      case "today":
        return setDateRange({ from: now, to: now });
      case "week":
        return setDateRange({ from: subWeeks(now, 1), to: now });
      case "month":
        return setDateRange({ from: subMonths(now, 1), to: now });
      case "6months":
        return setDateRange({ from: subMonths(now, 6), to: now });
      case "year":
        return setDateRange({ from: subYears(now, 1), to: now });
      case "reset":
        return setDateRange({ from: undefined, to: undefined });
    }
  };

  const saveSettings = () => {
    if (runningRef.current) return;
    localStorage.setItem("CRISP_IDENTIFIER", crispIdentifier);
    localStorage.setItem("CRISP_KEY", crispKey);
    localStorage.setItem("CRISP_WEBSITE_ID", crispWebsiteId);
    const job = loadJobRef.current;
    if (job && job.credentials.websiteId === crispWebsiteId) {
      // Allow a key to be renewed without discarding progress for the same site.
      job.credentials = { identifier: crispIdentifier, key: crispKey, websiteId: crispWebsiteId };
    } else {
      loadJobRef.current = null;
      setPausedLoad(null);
      setLoadingText("");
      setConversations([]);
      setConversationsReady(false);
      setCrispMessages([]);
      setMessagesReady(false);
    }
    toast.success("Settings saved!");
    setShowSettings(false);
  };

  const credentials = { identifier: crispIdentifier, key: crispKey, websiteId: crispWebsiteId };

  const runLoadJob = async (job: LoadJob) => {
    if (runningRef.current) return;
    runningRef.current = true;
    loadJobRef.current = job;
    setPausedLoad(null);
    setLoading(true);
    try {
      if (job.kind === "conversations") {
        const loaded = await loadConversations(job.checkpoint, page => {
          const params = new URLSearchParams({ page: String(page) });
          if (job.filters.conversation_updated_from) params.set("filter_date_start", job.filters.conversation_updated_from);
          if (job.filters.conversation_updated_to) params.set("filter_date_end", job.filters.conversation_updated_to);
          return fetchCrispData(`/api/crisp/conversations?${params}`, job.credentials);
        }, () => {
          setConversations([...job.checkpoint.conversations]);
          setLoadingText(`Conversations: ${job.checkpoint.conversations.length} saved. Requesting page ${job.checkpoint.nextPage}...`);
        });
        setConversations(loaded);
        setConversationsReady(true);
        setLoadedFilters(job.filters);
        if (loaded.length) toast.success(`Found ${loaded.length} conversations`);
        else toast.warning("No conversations found!");
      } else {
        const loaded = await loadAllConversationMessages(job.conversations, job.checkpoint, (sessionId, timestampBefore) => {
          const params = new URLSearchParams({ session_id: sessionId });
          if (timestampBefore !== undefined) params.set("timestamp_before", String(timestampBefore));
          return fetchCrispData(`/api/crisp/messages?${params}`, job.credentials);
        }, () => {
          const checkpoint = job.checkpoint;
          setCrispMessages(loadedMessageGroups(checkpoint, job.conversations));
          setLoadingText(`Conversations complete: ${checkpoint.conversationIndex} of ${job.conversations.length}. Current conversation: ${checkpoint.current.messages.length} messages saved, ${checkpoint.current.pages} batches.`);
        });
        setCrispMessages([...loaded]);
        setMessagesReady(true);
        toast.success(`Loaded ${loaded.reduce((count, group) => count + group.messages.length, 0)} messages across ${loaded.length} conversations`);
      }
      loadJobRef.current = null;
      setLoadingText("");
    } catch (error: unknown) {
      const message = errorMessage(error);
      setPausedLoad({ kind: job.kind, error: message });
      toast.warning(`Requests paused: ${message}. Progress is saved; resume when ready.`);
    } finally {
      runningRef.current = false;
      setLoading(false);
    }
  };

  const getConversations = async () => {
    if (runningRef.current || loadJobRef.current) return;
    setMessagesReady(false);
    setConversationsReady(false);
    setConversations([]);
    setCrispMessages([]);
    const filters: ExportFilters = {
      conversation_updated_from: dateRange?.from ? startOfDay(dateRange.from).toISOString() : null,
      conversation_updated_to: dateRange?.to ? endOfDay(dateRange.to).toISOString() : null,
    };
    setLoadedFilters(filters);
    await runLoadJob({ kind: "conversations", credentials, filters, checkpoint: createConversationsCheckpoint() });
  };

  const getAllMessages = async () => {
    if (runningRef.current || loadJobRef.current) return;
    if (!conversationsReady || !conversations.length) return toast.warning("Please finish loading conversations first!");
    setMessagesReady(false);
    setCrispMessages([]);
    await runLoadJob({ kind: "messages", credentials, conversations, checkpoint: createMessagesCheckpoint() });
  };

  const resumeLoad = async () => {
    const job = loadJobRef.current;
    if (job) await runLoadJob(job);
  };

  const resetPausedLoad = () => {
    if (runningRef.current) return;
    if (loadJobRef.current?.kind === "conversations") {
      setConversations([]);
      setConversationsReady(false);
    }
    loadJobRef.current = null;
    setPausedLoad(null);
    setLoadingText("");
    setCrispMessages([]);
    setMessagesReady(false);
  };

  const saveAllData = (format: "json" | "csv" | "xlsx") => {
    if (!messagesReady) return toast.warning("Please load all messages first!");
    try {
      const data = buildExport(conversations, messages, {
        ...loadedFilters,
        only_conversations_with_operator_reply: onlyOperatorReplies,
      });
      const options = { includeRaw: includeRawColumns };
      if (format === "json") {
        downloadText("crisp_export.json", JSON.stringify(data, null, 2), "application/json;charset=utf-8");
      } else if (format === "csv") {
        downloadText("crisp_export.csv", toCsv(messageRows(data, options), messageColumns(options)), "text/csv;charset=utf-8");
      } else {
        XLSX.writeFile(toWorkbook(data, options), "crisp_export.xlsx");
      }
      toast.success(`Exported ${data.message_count} messages from ${data.conversation_count} conversations as ${format.toUpperCase()}`);
    } catch (error: unknown) {
      toast.error(errorMessage(error));
    }
  };

  const copyConversations = async () => {
    if (conversations.length === 0)
      return toast.warning("No conversations available!");
    await navigator.clipboard.writeText(JSON.stringify(conversations, null, 2));
    toast.success(`Copied ${conversations.length} conversations to clipboard`);
  };

  const copyMessages = async () => {
    if (messages.length === 0) return toast.warning("No messages available!");
    await navigator.clipboard.writeText(JSON.stringify(messages, null, 2));
    toast.success(`Copied ${messages.length} message groups to clipboard`);
  };

  const renderSettingsModal = () => {
    if (!showSettings) return null;

    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
        <div className="bg-white dark:bg-zinc-900 p-6 rounded-lg w-full max-w-md">
          <h2 className="text-xl font-bold mb-4">Settings</h2>
          <div className="flex flex-col gap-3">
            <input
              placeholder="CRISP_IDENTIFIER"
              value={crispIdentifier}
              onChange={e => setCrispIdentifier(e.target.value)}
              className="p-2 border rounded"
            />
            <input
              type="password"
              placeholder="CRISP_KEY"
              value={crispKey}
              onChange={e => setCrispKey(e.target.value)}
              className="p-2 border rounded"
            />
            <input
              placeholder="CRISP_WEBSITE_ID"
              value={crispWebsiteId}
              onChange={e => setCrispWebsiteId(e.target.value)}
              className="p-2 border rounded"
            />
          </div>
          {pausedLoad && (
            <p className="mt-3 text-xs text-zinc-500">Оновлення ключа для того самого Website ID збереже прогрес. Зміна Website ID скине його.</p>
          )}
          <div className="flex justify-end gap-2 mt-4">
            <button
              onClick={() => setShowSettings(false)}
              className="px-4 py-2 rounded bg-gray-300 hover:bg-gray-400 dark:bg-zinc-700 dark:hover:bg-zinc-600"
            >
              Cancel
            </button>
            <button
              onClick={saveSettings}
              className="px-4 py-2 rounded bg-blue-600 text-white hover:bg-blue-700"
            >
              Save
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <>
      {renderSettingsModal()}

      <div className="flex flex-col min-h-screen items-center justify-center bg-zinc-50 dark:bg-black text-zinc-900 dark:text-zinc-100 p-10">
        <h1 className="text-3xl font-bold mb-2">💬 Crisp Export Tool</h1>
        <a
          href="https://github.com/JARVIS-VOVA/crisp-exporter"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 text-sm text-zinc-500 hover:text-blue-600 transition mb-6"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="currentColor"
            viewBox="0 0 24 24"
            className="w-5 h-5"
          >
            <path d="M12 .5C5.73.5.5 5.74.5 12.02a11.52 11.52 0 008.21 10.97c.6.12.82-.26.82-.58v-2.04c-3.34.73-4.04-1.61-4.04-1.61-.54-1.37-1.33-1.73-1.33-1.73-1.09-.75.08-.74.08-.74 1.2.08 1.83 1.23 1.83 1.23 1.07 1.83 2.8 1.3 3.48.99.11-.78.42-1.3.76-1.6-2.66-.3-5.46-1.33-5.46-5.9 0-1.3.47-2.36 1.23-3.19-.13-.3-.54-1.52.12-3.16 0 0 1-.32 3.3 1.22a11.47 11.47 0 016 0c2.3-1.54 3.3-1.22 3.3-1.22.66 1.64.25 2.86.12 3.16.76.83 1.23 1.89 1.23 3.19 0 4.59-2.8 5.6-5.47 5.9.43.37.81 1.1.81 2.23v3.3c0 .32.22.7.83.58A11.52 11.52 0 0023.5 12C23.5 5.74 18.27.5 12 .5z" />
          </svg>
          View on GitHub
        </a>

        <button
          onClick={() => setShowSettings(true)}
          disabled={loading}
          className="mb-4 w-full max-w-xl py-2 rounded-lg bg-yellow-500 text-black hover:bg-yellow-600"
        >
          ⚙️ Settings
        </button>

        <div className="flex flex-col items-center w-full">
          <Button
            onClick={() => setShowFilters(!showFilters)}
            className="mb-4 w-full max-w-xl py-2 rounded-lg bg-yellow-500 text-black hover:bg-yellow-600"
          >
            {showFilters ? "Hide filters" : "Show filters"}
          </Button>

          {showFilters && (
            <div className="flex flex-col md:flex-row gap-4 w-full max-w-xl py-2">
              <div className="flex flex-row md:flex-col flex-wrap gap-2 justify-center md:justify-start w-full md:w-auto">
                <Button variant="outline" size="sm" onClick={() => quickSelect("today")}>
                  Today
                </Button>
                <Button variant="outline" size="sm" onClick={() => quickSelect("week")}>
                  Last week
                </Button>
                <Button variant="outline" size="sm" onClick={() => quickSelect("month")}>
                  Last month
                </Button>
                <Button variant="outline" size="sm" onClick={() => quickSelect("6months")}>
                  Last 6 months
                </Button>
                <Button variant="outline" size="sm" onClick={() => quickSelect("year")}>
                  Last year
                </Button>
                <Button variant="secondary" size="sm" onClick={() => quickSelect("reset")}>
                  All time
                </Button>
              </div>

              <div className="w-full flex justify-center md:justify-end md:flex-1">
                <Calendar
                  mode="range"
                  defaultMonth={dateRange?.from}
                  selected={dateRange}
                  onSelect={setDateRange}
                  className="rounded-lg border shadow-sm"
                />
              </div>
            </div>
          )}
        </div>

        <div className="w-full max-w-xl mx-auto p-4 rounded-lg border bg-zinc-50 dark:bg-zinc-900 dark:border-zinc-700 text-zinc-800 dark:text-zinc-100 shadow-sm py-2">
          <h3 className="font-semibold mb-2 text-sm">Selected filters (conversation update date):</h3>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <div className="text-sm">
              <span className="font-medium">Date range:</span>{" "}
              {formatDate(dateRange?.from)} — {formatDate(dateRange?.to)}
            </div>
          </div>
          <p className="text-xs text-zinc-500 mt-2">Dates select conversations by their last update. All messages in each selected conversation are included.</p>
        </div>

        <div className="flex flex-col gap-4 w-full max-w-xl mt-15">
          <button
            onClick={getConversations}
            disabled={loading || pausedLoad !== null}
            className="w-full py-3 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
          >
            1️⃣ Get Conversations
          </button>

          <button
            onClick={getAllMessages}
            disabled={loading || pausedLoad !== null || !conversationsReady || conversations.length === 0}
            className="w-full py-3 rounded-lg bg-green-600 text-white hover:bg-green-700 disabled:opacity-50"
          >
            2️⃣ Get Messages
          </button>

          {pausedLoad && (
            <div role="alert" className="rounded-lg border border-amber-500 p-4 space-y-3 text-sm">
              <p className="font-semibold">{pausedLoad.kind === "messages" ? "Завантаження повідомлень призупинено" : "Завантаження діалогів призупинено"}</p>
              <p>{pausedLoad.error}</p>
              <p>{loadingText}</p>
              <p>Прогрес збережено в пам’яті цієї вкладки. Коли ліміт відновиться, продовжіть із невдалого запиту. Продовження використовує той самий період.</p>
              <div className="flex flex-wrap gap-3">
                <button
                  onClick={resumeLoad}
                  disabled={loading}
                  className="rounded-lg bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  Продовжити запити
                </button>
                <button onClick={resetPausedLoad} disabled={loading} className="rounded-lg border px-4 py-2 disabled:opacity-50">
                  Скинути прогрес
                </button>
              </div>
            </div>
          )}

          <div className="rounded-lg border p-4 space-y-3 text-sm">
            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={onlyOperatorReplies}
                onChange={event => setOnlyOperatorReplies(event.target.checked)}
                disabled={loading}
                className="mt-1"
              />
              <span>Only conversations with operator replies</span>
            </label>
            <p className="text-xs text-zinc-500">
              Requires a non-empty customer-facing operator message not marked automated=true.
              A missing automated flag is allowed. Notes, events and hidden messages do not qualify.
              Each included conversation keeps its full history.
            </p>
            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={includeRawColumns}
                onChange={event => setIncludeRawColumns(event.target.checked)}
                disabled={loading}
                className="mt-1"
              />
              <span>Include original payload columns in CSV/XLSX (larger files)</span>
            </label>
            <p className="text-xs text-zinc-500">JSON always includes original data. Customer metadata is kept as returned by Crisp.</p>
            {messagesReady && (
              <p role="status">
                Export: {exportGroups.length} of {conversations.length} conversations,
                {" "}{exportMessageCount} messages.
                {" "}Excluded: {conversations.length - exportGroups.length} conversations.
                {exportGroups.length === 0 && " No conversations match the filter. Downloads will contain no messages."}
              </p>
            )}
          </div>

          <div className="flex gap-3 w-full">
            {(["json", "csv", "xlsx"] as const).map(format => (
              <button
                key={format}
                onClick={() => saveAllData(format)}
                disabled={loading || !messagesReady}
                className="flex-1 py-3 rounded-lg bg-gray-800 text-white hover:bg-gray-900 disabled:opacity-50"
              >
                Save {format.toUpperCase()}
              </button>
            ))}
          </div>
          <p className="text-xs text-zinc-500">CSV/XLSX are compact by default and preserve authors, automated flags, notes and attachment URLs. Files themselves are not downloaded.</p>

          <div className="flex gap-4 w-full">
            <button
              onClick={copyConversations}
              disabled={loading || conversations.length === 0}
              className="flex-1 py-3 rounded-lg bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50"
            >
              📋 Copy All Conversations
            </button>

            <button
              onClick={copyMessages}
              disabled={loading || messages.length === 0}
              className="flex-1 py-3 rounded-lg bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-50"
            >
              📋 Copy All Messages
            </button>
          </div>
        </div>

        <div className="mt-6 flex gap-4 w-full max-w-xl">
          <div className="flex-1 text-right text-sm text-zinc-500">
            💭 Conversations:{" "}
            <span className="font-bold text-blue-600">{conversations.length}</span>
          </div>

          <div className="flex-1 text-left text-sm text-zinc-500">
            💬 Messages:{" "}
            <span className="font-bold text-green-600">{messageCount}</span>
          </div>
        </div>

        {loading && (
          <p className="mt-6 text-blue-500 animate-pulse">⏳ {loadingText}</p>
        )}
      </div>
    </>
  );
}
