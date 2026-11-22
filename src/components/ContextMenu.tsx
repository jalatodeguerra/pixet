import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useEditorStore } from "../store/editorStore";

export function ContextMenu() {
  const contextMenu = useEditorStore((s) => s.contextMenu);
  const closeContextMenu = useEditorStore((s) => s.closeContextMenu);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: 0, top: 0 });

  useLayoutEffect(() => {
    if (!contextMenu) return;
    const el = menuRef.current;
    const width = el?.offsetWidth ?? 190;
    const height = el?.offsetHeight ?? 240;
    const left = Math.max(
      6,
      Math.min(contextMenu.x, window.innerWidth - width - 6)
    );
    const top = Math.max(
      6,
      Math.min(contextMenu.y, window.innerHeight - height - 6)
    );
    setPos({ left, top });
  }, [contextMenu]);

  useEffect(() => {
    if (!contextMenu) return;

    const onMouseDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        closeContextMenu();
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        closeContextMenu();
      }
    };
    const onDismiss = () => closeContextMenu();

    window.addEventListener("mousedown", onMouseDown);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("blur", onDismiss);
    window.addEventListener("scroll", onDismiss, true);
    return () => {
      window.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("blur", onDismiss);
      window.removeEventListener("scroll", onDismiss, true);
    };
  }, [contextMenu, closeContextMenu]);

  if (!contextMenu) return null;

  return (
    <div
      ref={menuRef}
      className="context-menu"
      role="menu"
      style={{ left: pos.left, top: pos.top }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {contextMenu.items.map((item, idx) =>
        item.kind === "separator" ? (
          <div key={`sep-${idx}`} className="context-menu-sep" />
        ) : (
          <button
            key={`${item.label}-${idx}`}
            type="button"
            role="menuitem"
            disabled={item.disabled}
            className={`context-menu-item ${item.danger ? "danger" : ""}`}
            onClick={() => {
              if (item.disabled) return;
              closeContextMenu();
              item.action();
            }}
          >
            <span>{item.label}</span>
            {item.shortcut && (
              <span className="menu-shortcut">{item.shortcut}</span>
            )}
          </button>
        )
      )}
    </div>
  );
}
