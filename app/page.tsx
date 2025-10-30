"use client";

import React from "react";
import * as XLSX from "xlsx";
import { toast } from "sonner";

function formatTimestamp(timestamp: number): string {
  const date = new Date(timestamp);

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");

  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

export default function Home() {
  const [loading, setLoading] = React.useState(false);
  const [loadingText, setLoadingText] = React.useState("");
  const [conversations, setConversations] = React.useState<any[]>([]);
  const [messages, setCrispMessages] = React.useState<any[]>([]);

  const [showSettings, setShowSettings] = React.useState(false);
  const [crispIdentifier, setCrispIdentifier] = React.useState("");
  const [crispKey, setCrispKey] = React.useState("");
  const [crispWebsiteId, setCrispWebsiteId] = React.useState("");

  React.useEffect(() => {
    const savedIdentifier = localStorage.getItem("CRISP_IDENTIFIER") || "";
    const savedKey = localStorage.getItem("CRISP_KEY") || "";
    const savedWebsiteId = localStorage.getItem("CRISP_WEBSITE_ID") || "";
    setCrispIdentifier(savedIdentifier);
    setCrispKey(savedKey);
    setCrispWebsiteId(savedWebsiteId);
  }, []);

  const saveSettings = () => {
    localStorage.setItem("CRISP_IDENTIFIER", crispIdentifier);
    localStorage.setItem("CRISP_KEY", crispKey);
    localStorage.setItem("CRISP_WEBSITE_ID", crispWebsiteId);
    toast.success("Settings saved!");
    setShowSettings(false);
  };

  function addCrispKeys(url: string): string {
    if (!crispIdentifier || !crispKey || !crispWebsiteId) {
      toast.error("Crisp credentials are missing!");
      throw new Error("Crisp credentials are missing in localStorage!");
    }

    const parsedUrl = new URL(url, window.location.origin);
    parsedUrl.searchParams.set("crisp_identifier", crispIdentifier);
    parsedUrl.searchParams.set("crisp_key", crispKey);
    parsedUrl.searchParams.set("crisp_website_id", crispWebsiteId);

    return parsedUrl.toString();
  }

  const getConversations = async () => {
    try {
      setLoading(true);
      setLoadingText("Loading conversations...");
      let page = 1;
      let allConvs: any[] = [];

      while (true) {
        setLoadingText(`Loading conversations, page ${page}...`);
        const url = addCrispKeys(`/api/crisp/conversations?page=${page}`);
        const res = await fetch(url);
        const json = await res.json();

        if (!res.ok) {
          throw json;
        }

        const data = json.data;
        if (!Array.isArray(data) || data.length === 0) {
          console.log("No more data or invalid format");
          break;
        }

        allConvs = [...allConvs, ...data];
        page++;
      }

      setConversations(allConvs);
      if (allConvs.length === 0) {
        toast.warning("No conversations found!");
      } else {
        toast.success(`Found ${allConvs.length} conversations`);
      }
    } catch (err: any) {
      const message = err?.error?.data?.message || "Crisp API error";
      const reason = err?.error?.reason;

      if (message) {
        toast.error(`Crisp API error (message): ${message}`);
      }
      if (reason) {
        toast.error(`Crisp API error (reason): ${reason}`);
      }
      if (!message && !reason) {
        toast.error('Error fetching conversations');
      }
    } finally {
      setLoading(false);
      setLoadingText("");
    }
  };


  const getAllMessages = async () => {
    if (conversations.length === 0) {
      return toast.warning("Please load conversations first!");
    }

    try {
      setLoading(true);
      const allMessages: any[] = [];

      let page = 0;
      for (const conversation of conversations) {
        page++;
        setLoadingText(`Loading messages ${page} of ${conversations.length}...`);

        const sessionId = conversation.session_id;
        const url = addCrispKeys(`/api/crisp/messages?session_id=${sessionId}`);
        const res = await fetch(url);
        const json = await res.json();

        if (!res.ok) {
          throw json;
        }

        const msgs = json?.data;
        allMessages.push({
          session_id: sessionId,
          messages: Array.isArray(msgs) ? msgs : [],
        });
      }

      setCrispMessages(allMessages);
      if (allMessages.length === 0) {
        toast.warning("No messages found!");
      } else {
        toast.success(`Loaded messages for ${allMessages.length} conversations`);
      }
    } catch (err: any) {
      const message = err?.error?.data?.message || "Crisp API error";
      const reason = err?.error?.reason;

      if (message) {
        toast.error(`Crisp API error (message): ${message}`);
      }
      if (reason) {
        toast.error(`Crisp API error (reason): ${reason}`);
      }
      if (!message && !reason) {
        toast.error('Error fetching messages');
      }
    } finally {
      setLoading(false);
      setLoadingText("");
    }
  };

  const saveAllData = () => {
    if (!messages || messages.length === 0) {
      return toast.warning("Please load messages first!");
    }

    const rows: any[] = [];

    messages.forEach(conv => {
      conv.messages.forEach((msg: any) => {
        rows.push({
          session_id: conv.session_id,
          sender: msg.from,
          text: msg.content,
          timestamp: formatTimestamp(msg.timestamp),
        });
      });
    });

    const worksheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Crisp Messages");

    XLSX.writeFile(workbook, "crisp_export.xlsx");

    toast.success(`Exported ${rows.length} messages to file`);
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
          className="mb-4 w-full max-w-xl py-2 rounded-lg bg-yellow-500 text-black hover:bg-yellow-600"
        >
          ⚙️ Settings
        </button>

        <div className="flex flex-col gap-4 w-full max-w-xl">
          <button
            onClick={getConversations}
            disabled={loading}
            className="w-full py-3 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
          >
            1️⃣ Get Conversations
          </button>

          <button
            onClick={getAllMessages}
            disabled={loading}
            className="w-full py-3 rounded-lg bg-green-600 text-white hover:bg-green-700 disabled:opacity-50"
          >
            2️⃣ Get Messages
          </button>

          <button
            onClick={saveAllData}
            disabled={loading || conversations.length === 0}
            className="w-full py-3 rounded-lg bg-gray-800 text-white hover:bg-gray-900 disabled:opacity-50"
          >
            💾 Save All to File
          </button>

          <div className="flex gap-4 w-full">
            <button
              onClick={copyConversations}
              disabled={loading || conversations.length === 0}
              className="flex-1 py-3 rounded-lg bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50"
            >
              📋 Copy Conversations
            </button>

            <button
              onClick={copyMessages}
              disabled={loading || messages.length === 0}
              className="flex-1 py-3 rounded-lg bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-50"
            >
              📋 Copy Messages
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
            <span className="font-bold text-green-600">{messages.length}</span>
          </div>
        </div>

        {loading && (
          <p className="mt-6 text-blue-500 animate-pulse">⏳ {loadingText}</p>
        )}
      </div>
    </>
  );
}
