import { MoreHorizontal } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button, Menu, MenuItem, cn } from '../ui.tsx';

export interface MoreItem {
  label: ReactNode;
  icon?: ReactNode;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
  title?: string;
}

/** "⋯" overflow menu for secondary actions. */
export function MoreMenu({ items, size = 'sm', label }: { items: MoreItem[]; size?: 'sm' | 'md'; label?: string }) {
  return (
    <Menu
      width="w-52"
      trigger={({ open, toggle }) => (
        <Button size={size} onClick={toggle} className={cn(open && 'bg-zinc-700')} title={label ?? 'More actions'} aria-label={label ?? 'More actions'}>
          <MoreHorizontal size={14} />
          {label && <span>{label}</span>}
        </Button>
      )}
    >
      {(close) =>
        items.map((it, i) => (
          <MenuItem
            key={i}
            icon={it.icon}
            danger={it.danger}
            disabled={it.disabled}
            title={it.title}
            onClick={() => {
              close();
              it.onClick();
            }}
          >
            {it.label}
          </MenuItem>
        ))
      }
    </Menu>
  );
}
