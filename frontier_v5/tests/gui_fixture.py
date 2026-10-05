#!/usr/bin/env python3
from pathlib import Path
import tkinter as tk

out=Path(__file__).resolve().parent/"_gui_result.txt"
root=tk.Tk(); root.title("MUSITU Desktop Fixture"); root.geometry("420x180")
label=tk.Label(root,text="MUSITU Axiom Desktop Verification"); label.pack(pady=12)
entry=tk.Entry(root,width=40); entry.pack(); entry.focus_set()
status=tk.Label(root,text="waiting"); status.pack(pady=10)

def submit(event=None):
    value=entry.get().strip()
    out.write_text(value,encoding="utf-8")
    status.configure(text="verified:"+value)
    root.after(400,root.destroy)
entry.bind("<Return>",submit)
root.mainloop()
