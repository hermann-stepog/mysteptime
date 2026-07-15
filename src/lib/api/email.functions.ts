import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { sendEmail } from "../email.server";

export const sendNominationPhaseEmail = createServerFn({ method: "POST" })
  .inputValidator(z.object({
    to: z.string().email(),
    subject: z.string().min(1),
    text: z.string().min(1),
  }))
  .handler(async ({ data }) => {
    await sendEmail(data);
    return { sent: true };
  });
