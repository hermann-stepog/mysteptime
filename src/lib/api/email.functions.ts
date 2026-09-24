import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { sendEmail } from "../email.server";
import { sendResendTemplateEmail } from "../resend.server";

export const sendNominationPhaseEmail = createServerFn({ method: "POST" })
  .inputValidator(z.object({
    to: z.string().email(),
    cc: z.string().optional(),
    subject: z.string().min(1),
    text: z.string().min(1),
  }))
  .handler(async ({ data }) => {
    await sendEmail(data);
    return { sent: true };
  });

export const sendResendTemplatedEmail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({
    to: z.string().email(),
    cc: z.array(z.string().email()).optional(),
    templateId: z.string().min(1),
    variables: z.record(z.string(), z.string()),
  }))
  .handler(async ({ data, context }) => {
    await sendResendTemplateEmail(data, context.supabase);
    return { sent: true };
  });
