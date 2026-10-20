"use client";

import * as React from "react";
import { type DialogProps } from "@radix-ui/react-dialog";
import { Command as CommandPrimitive } from "cmdk";
import { Search } from "lucide-react";

import { cn } from "@/lib/utils";
import { Dialog, DialogContent } from "@/components/ui/dialog";

const Command = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive>
>(({ className, onKeyDown, onMouseMove, ...props }, ref) => {
  // Pedido dela (2026-10-19, corrigido no mesmo dia): Tab já confirma o item destacado (por
  // mouse ou setas) antes de sair do campo, em vez de precisar clicar — vale pra todo combobox
  // construído em cima deste componente (SearchableSelect, SearchableMultiSelect, Motivo,
  // Forma de pagamento, BSP, Unidade, trajetos do Simulador de Custos etc.), já que todos usam
  // este wrapper.
  //
  // Primeira versão só confirmava depois de um evento onMouseMove dentro da lista — mas
  // onMouseMove exige o ponteiro realmente se MEXER; se o item desejado for o primeiro da
  // lista (que o cmdk já destaca sozinho ao abrir) e o mouse ficar parado em cima dele sem
  // deslizar, nenhum mousemove dispara e o Tab não confirmava nada (bug relatado: Unidade do
  // formulário de Transporte, onde a opção certa costuma já estar em cima do clique que abriu
  // o campo). Corrigido pra checar ":hover" de verdade no momento do Tab, em vez de depender
  // de ter capturado um evento de movimento — cobre tanto o mouse parado em cima do item
  // quanto o destacado só pelas setas do teclado.
  const interagiuPorTecladoRef = React.useRef(false);
  return (
    <CommandPrimitive
      ref={ref}
      className={cn(
        "flex h-full w-full flex-col overflow-hidden rounded-md bg-popover text-popover-foreground",
        className,
      )}
      onMouseMove={onMouseMove}
      onKeyDown={(e) => {
        if (e.key === "ArrowUp" || e.key === "ArrowDown") interagiuPorTecladoRef.current = true;
        if (e.key === "Tab" && !e.defaultPrevented) {
          const item = e.currentTarget.querySelector<HTMLElement>(
            '[cmdk-item=""][aria-selected="true"]',
          );
          if (item && (interagiuPorTecladoRef.current || item.matches(":hover"))) {
            item.dispatchEvent(new Event("cmdk-item-select"));
          }
        }
        onKeyDown?.(e);
      }}
      {...props}
    />
  );
});
Command.displayName = CommandPrimitive.displayName;

const CommandDialog = ({ children, ...props }: DialogProps) => {
  return (
    <Dialog {...props}>
      <DialogContent className="overflow-hidden p-0">
        <Command className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group]:not([hidden])_~[cmdk-group]]:pt-0 [&_[cmdk-group]]:px-2 [&_[cmdk-input-wrapper]_svg]:h-5 [&_[cmdk-input-wrapper]_svg]:w-5 [&_[cmdk-input]]:h-12 [&_[cmdk-item]]:px-2 [&_[cmdk-item]]:py-3 [&_[cmdk-item]_svg]:h-5 [&_[cmdk-item]_svg]:w-5">
          {children}
        </Command>
      </DialogContent>
    </Dialog>
  );
};

const CommandInput = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.Input>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Input>
>(({ className, ...props }, ref) => (
  <div className="flex items-center border-b px-3" cmdk-input-wrapper="">
    <Search className="mr-2 h-4 w-4 shrink-0 opacity-50" />
    <CommandPrimitive.Input
      ref={ref}
      className={cn(
        "flex h-10 w-full rounded-md bg-transparent py-3 text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  </div>
));

CommandInput.displayName = CommandPrimitive.Input.displayName;

const CommandList = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.List>
>(({ className, onWheel, ...props }, ref) => (
  <CommandPrimitive.List
    ref={ref}
    className={cn("max-h-[300px] overflow-y-auto overflow-x-hidden", className)}
    // Pedido dela (2026-10-20): roda do mouse não rolava essa lista quando o combobox abre por
    // cima de um formulário em modal (Dialog) — o bloqueio de rolagem do fundo da página que o
    // Radix liga enquanto o modal está aberto (react-remove-scroll) às vezes intercepta a roda
    // do mouse mesmo dentro de um popover que fica por cima, mesmo a lista sendo rolável. Rola
    // a própria lista na mão e impede o evento de chegar nesse bloqueio, pra funcionar sempre,
    // dentro ou fora de um modal.
    onWheel={(e) => {
      e.currentTarget.scrollTop += e.deltaY;
      e.stopPropagation();
      e.preventDefault();
      onWheel?.(e);
    }}
    {...props}
  />
));

CommandList.displayName = CommandPrimitive.List.displayName;

const CommandEmpty = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.Empty>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Empty>
>((props, ref) => (
  <CommandPrimitive.Empty ref={ref} className="py-6 text-center text-sm" {...props} />
));

CommandEmpty.displayName = CommandPrimitive.Empty.displayName;

const CommandGroup = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.Group>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Group>
>(({ className, ...props }, ref) => (
  <CommandPrimitive.Group
    ref={ref}
    className={cn(
      "overflow-hidden p-1 text-foreground [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground",
      className,
    )}
    {...props}
  />
));

CommandGroup.displayName = CommandPrimitive.Group.displayName;

const CommandSeparator = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <CommandPrimitive.Separator
    ref={ref}
    className={cn("-mx-1 h-px bg-border", className)}
    {...props}
  />
));
CommandSeparator.displayName = CommandPrimitive.Separator.displayName;

const CommandItem = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Item>
>(({ className, ...props }, ref) => (
  <CommandPrimitive.Item
    ref={ref}
    className={cn(
      "relative flex cursor-default gap-2 select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none data-[disabled=true]:pointer-events-none data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground data-[disabled=true]:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
      className,
    )}
    {...props}
  />
));

CommandItem.displayName = CommandPrimitive.Item.displayName;

const CommandShortcut = ({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) => {
  return (
    <span
      className={cn("ml-auto text-xs tracking-widest text-muted-foreground", className)}
      {...props}
    />
  );
};
CommandShortcut.displayName = "CommandShortcut";

export {
  Command,
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandShortcut,
  CommandSeparator,
};
