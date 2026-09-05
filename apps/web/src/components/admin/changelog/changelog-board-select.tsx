import { useState } from 'react'
import { PlusIcon } from '@heroicons/react/24/outline'
import { XMarkIcon } from '@heroicons/react/24/solid'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useBoards } from '@/lib/client/hooks/use-boards-query'
import { cn } from '@/lib/shared/utils'
import type { BoardId } from '@quackback/ids'

interface ChangelogBoardSelectProps {
  value: BoardId[]
  onChange: (boardIds: BoardId[]) => void
}

/**
 * Which products (boards) an entry is about, as removable chips with an "Add"
 * popover — deliberately the same control as the label picker beside it, since
 * both answer "what does this entry belong to".
 *
 * Selecting nothing is a choice, not an omission: an unassigned entry is a
 * cross-product announcement and shows under every product filter on the public
 * changelog. The hint below the empty control says so, because the opposite
 * reading ("nobody will see this") is the natural one and is wrong.
 */
export function ChangelogBoardSelect({ value, onChange }: ChangelogBoardSelectProps) {
  const [open, setOpen] = useState(false)
  const { data: boards = [] } = useBoards()

  const selected = boards.filter((b) => value.includes(b.id))
  const unselected = boards.filter((b) => !value.includes(b.id))

  function toggle(id: BoardId) {
    if (value.includes(id)) {
      onChange(value.filter((v) => v !== id))
    } else {
      onChange([...value, id])
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {selected.map((board) => (
        <span
          key={board.id}
          className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-foreground/80"
        >
          {board.name}
          <button
            type="button"
            onClick={() => toggle(board.id)}
            aria-label={`Remove ${board.name}`}
            className="opacity-60 hover:opacity-100"
          >
            <XMarkIcon className="h-3 w-3" />
          </button>
        </span>
      ))}

      {selected.length === 0 && (
        <span className="text-[11px] text-muted-foreground/60 italic">All products</span>
      )}

      {boards.length > 0 && (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              className={cn(
                'inline-flex items-center gap-0.5 px-1.5 py-0.5',
                'rounded-md text-[11px] font-medium',
                'text-muted-foreground/70 hover:text-muted-foreground',
                'border border-dashed border-border/60 hover:border-border',
                'hover:bg-muted/40',
                'transition-all duration-150'
              )}
            >
              <PlusIcon className="h-2.5 w-2.5" />
              Add
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-56 p-1" align="start">
            {unselected.length === 0 ? (
              <p className="py-4 text-center text-xs text-muted-foreground">All products added</p>
            ) : (
              unselected.map((board) => (
                <button
                  key={board.id}
                  type="button"
                  onClick={() => toggle(board.id)}
                  className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent"
                >
                  <span className="flex-1 text-left truncate">{board.name}</span>
                </button>
              ))
            )}
          </PopoverContent>
        </Popover>
      )}
    </div>
  )
}
