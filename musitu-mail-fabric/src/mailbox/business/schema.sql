CREATE TABLE IF NOT EXISTS mailbox_message (
 mailbox TEXT NOT NULL, id TEXT NOT NULL, folder TEXT NOT NULL CHECK(folder IN ('inbox','archive','trash','drafts','sending','sent','unknown')),
 previous_folder TEXT, sender TEXT NOT NULL, recipient TEXT NOT NULL, subject TEXT NOT NULL, body TEXT NOT NULL, raw_key TEXT, received_at TEXT NOT NULL,
 is_read INTEGER NOT NULL DEFAULT 0 CHECK(is_read IN (0,1)), starred INTEGER NOT NULL DEFAULT 0 CHECK(starred IN (0,1)), provider_id TEXT, send_status TEXT, PRIMARY KEY(mailbox,id)
);
CREATE INDEX IF NOT EXISTS mailbox_folder_time ON mailbox_message(mailbox,folder,received_at DESC,id);
