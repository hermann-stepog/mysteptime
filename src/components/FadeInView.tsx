import { motion, type Variants } from "framer-motion";
import type { ReactNode } from "react";

// Fade + leve slide-up, disparado só quando o elemento entra na viewport (não tudo de uma vez
// no load) — "once: true" pra não reanimar toda vez que rola pra cima/baixo de novo.
const fadeInUp: Variants = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0 },
};

interface FadeInViewProps {
  children: ReactNode;
  delay?: number;
  className?: string;
}

// Uso genérico — cards, seções, itens de lista.
export function FadeInView({ children, delay = 0, className }: FadeInViewProps) {
  return (
    <motion.div
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, margin: "-40px" }}
      variants={fadeInUp}
      transition={{ duration: 0.35, delay, ease: "easeOut" }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

// Variante <tr> — pra linhas de tabela/grid, sem quebrar a semântica da tabela.
export function FadeInRow({ children, delay = 0, className }: FadeInViewProps) {
  return (
    <motion.tr
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, margin: "-40px" }}
      variants={fadeInUp}
      transition={{ duration: 0.3, delay, ease: "easeOut" }}
      className={className}
    >
      {children}
    </motion.tr>
  );
}
