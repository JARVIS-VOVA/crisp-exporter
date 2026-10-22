# Crisp Exporter

## 🔗 Links
- **🌐 Website**: [https://crisp-exporter.vercel.app](https://crisp-exporter.vercel.app)
- **🚀 Vercel**: [https://vercel.com/jarvisvovas-projects/crisp-exporter](https://vercel.com/jarvisvovas-projects/crisp-exporter)

## 🛠️ Technologies
- Framework: Next.js 16.4.2 (App Router)
- Language: TypeScript
- Styling: Tailwind CSS
- Deployment: Vercel

## 🚀 Setup & Quick Start
```bash
bun install
bun run dev
# Open http://localhost:3000 in your browser
```

## Exporting

1. Open **Settings** and enter your Crisp plugin identifier, key and website ID.
   The plugin needs read access to `website:conversation:sessions` and
   `website:conversation:messages`.
2. Select a date range (the default is **6 months**), **Last year**, or **All time**,
   and click **Get Conversations**.
3. Click **Get Messages**. The exporter reads every conversation page and every
   message batch, including older messages via `timestamp_before`, until the API
   returns an empty batch. Progress and message counts update after each
   successful batch. If a request fails or the quota is exhausted, loading pauses
   without discarding the batches already received.
4. Review the export options and the included/excluded conversation counts, then
   download **JSON**, **CSV** or **XLSX**. Downloads stay disabled until every
   selected conversation has finished loading successfully. A filter that matches
   no conversations still allows downloads: CSV has only column headers, JSON has
   an empty conversation list, and XLSX has empty data sheets plus export info.

**Only conversations with operator replies** is enabled by default. A
conversation qualifies if it has at least one nonempty customer-facing message
from `operator` that is **not marked `automated: true`**. Crisp can omit the
`automated` field on operator messages, so both `false` and an absent flag qualify.
Text, files, audio, animations and
interactive messages can qualify. Internal notes, events and hidden (`stealth`)
messages do not qualify. An absent flag does not prove a human authored the message;
automation that an integration did not mark cannot be identified by this filter. No
inference is made from response time or an operator's name. All operators are
eligible; choosing whose writing is the reference style remains a curation step.
The filter applies to JSON, CSV and XLSX downloads, and the full history of each
included conversation is retained, including bot messages and notes. Turn the
filter off to export every loaded conversation. Clipboard buttons copy all loaded
data. Changing the export options does not require fetching messages again.

CSV/XLSX are **compact by default**: `raw_message_json`, `conversation_raw_json`,
`conversation_meta_json` and `content_json` are omitted. Enable **Include original
payload columns in CSV/XLSX** to restore them. JSON always retains original data
for the conversations included by the export filter.

Date filters select conversations by their **last update**, as defined by Crisp;
they do not filter individual messages. Selected dates cover full local calendar
days. The exporter includes the full history of each selected conversation,
including messages outside that range. Exports record the filters used for the
loaded data, even if you subsequently change the date picker.

Credentials are saved in this browser's local storage. Requests to the local API
carry credentials in headers, never in URLs. Starting a new conversation load
clears the previous messages so data from different loads cannot be mixed. API
responses are not cached.

## Pausing and resuming

- Rate limits (`429`) and quota errors pause loading immediately. Temporary
  upstream failures (`502`, `503`, `504`) are retried up to three times before
  pausing. Other request and validation errors also preserve progress and pause.
- The **Продовжити запити** button retries the failed request when you are ready.
  It keeps the original date filters, completed conversations, messages already
  received in the current conversation, and the last successful pagination
  cursor. Successful batches are not requested again; overlapping message IDs
  remain deduplicated.
- This works both while loading the conversation list and while loading message
  history. Further requests stop while paused. New loads stay disabled until you
  resume or explicitly choose **Скинути прогрес**.
- You can renew credentials in Settings while paused without losing progress if
  the Website ID remains the same. Changing the Website ID resets the data.
- CSV/JSON/XLSX downloads become available only after all messages finish loading;
  clipboard buttons can copy the data received so far, including the current
  partial conversation.
- Progress is kept **in the current tab's memory**. Keep the page open while
  waiting for quota to replenish. Refreshing or closing it discards the load;
  saved credentials in local storage remain available.

## Export contents

- `message_id`: Crisp's original `fingerprint`. Pagination overlap is deduplicated
  by this identifier within a conversation. Identical text with distinct IDs is
  retained; messages without an ID are retained too.
- `timestamp_ms`: the original numeric Unix timestamp in milliseconds.
  `timestamp_iso` is UTC with milliseconds (`...123Z`). `message_index` records the
  exported chronological order within the conversation. Equal timestamps retain
  API source order; they do not establish a more precise sending order.
- `from`, `operator_id`, `operator_name`, `sender_id`, `sender_name`, `type`,
  `origin` and `automated` preserve sender and message information. Automation is
  determined **only** from Crisp's `automated` field: `true`, `false`, or unknown
  (`null` in JSON, blank in CSV/XLSX). Response speed and sender names are not used
  to guess automation. Internal `note` and `event` messages remain distinct types.
- `text` retains the source text. For files without text it contains a marker
  such as `[image]`, `[file]` or `[audio]`. `text_clean` additionally normalizes
  `_x000d_` and CR/CRLF line endings, without changing the original data.
- `file_url`, `file_name`, `file_mime_type` and attachment data preserve media
  references. File, animation and audio messages are supported. All structured
  content, including picker, field, carousel and event data, is retained in full
  in JSON and in CSV/XLSX when original payload columns are enabled. Compact
  CSV/XLSX retain attachment metadata in `attachments_json` and the extracted
  fields; other structured content requires JSON or the original payload columns.
  **Attachment binaries are not downloaded**; their availability depends on the
  original URLs.
- Client email, nickname, locales, segments and custom data come from conversation
  metadata. Plan/status are available if your integration stored them there.
  These are metadata as returned at export time, not historical account snapshots.
  `user_data_json` is kept unchanged; no historical plan/status is reconstructed.
  The separate `user_id` column comes only from `meta.data.user_id`, when present.
  It is blank if that field is missing; it is never filled with an operator or
  session ID. Keep `user_data_json` if your integration stores its ID under a
  different custom key.

**JSON** contains a schema version, export time, loaded filters, counts and a
`conversations` array. Each entry has the untouched conversation in `raw` and
normalized `messages`; each message also includes its untouched `raw` object and
structured `content`/`attachments`. Counts record the loaded, exported and excluded
conversations. Empty conversations are retained if returned by Crisp and the
operator reply filter is disabled.

**CSV** has one row per message, with UTF-8 BOM, CRLF record separators and quoted
fields for multiline text, commas and quotes. Nested attachment and customer data
use `*_json` columns; the four original payload columns are optional. Empty
conversations have no message row.

**XLSX** includes `Messages`, `Conversations` and `Export Info` sheets. The message
columns match CSV. If a value exceeds Excel's cell text limit, its first part is
stored in the original cell and remaining parts in `Cell Overflow`. Recover it
by concatenating the original value and the matching `sheet`/`row`/`column` parts
in ascending `part` order. `row` is the 1-based worksheet row, including its header.
Splitting preserves Unicode characters and literal OOXML escape sequences.

Apart from the conversation-level operator reply filter, no messages are removed
because they look like templates, old prices or noise; curation can be performed
separately against the preserved source data.

## Validation

```bash
bun test
bunx tsc --noEmit
bun run lint
bun run build
```

Tests use synthetic Crisp responses (no account credentials or live API calls)
to cover pagination, overlap, failures, API parameter forwarding, automation,
metadata and JSON/CSV/XLSX round trips, including attachments and oversized text,
compact exports, customer ID extraction and conversation-level operator reply filters.
Resume tests cover quota failures midway through a conversation, repeated pauses,
failed final batches, invalid responses, and recovery of conversation pagination
without repeating already completed requests.

API reference: [Crisp messages](https://docs.crisp.chat/references/rest-api/v1/#get-messages-in-conversation)
and [conversation filters](https://docs.crisp.chat/references/rest-api/v1/#list-conversations).
