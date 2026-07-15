import { Outlet, useRouterState } from "@tanstack/react-router";
import { AnimatePresence, motion } from "framer-motion";

// Substitui o <Outlet /> dentro de um layout (admin/app/pm) pra transicionar só a área de
// conteúdo entre páginas (fade + leve slide), sem afetar o header/nav que fica por fora dele.
// A key é o pathname atual: ao mudar de rota, a página antiga sai e a nova entra.
export function AnimatedOutlet() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={pathname}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -8 }}
        transition={{ duration: 0.18, ease: "easeInOut" }}
      >
        <Outlet />
      </motion.div>
    </AnimatePresence>
  );
}
