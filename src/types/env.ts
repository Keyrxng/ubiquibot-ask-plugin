import { Type as T } from "@sinclair/typebox";
import { StaticDecode } from "@sinclair/typebox";
import "dotenv/config";

export const envSchema = T.Object({
  GITHUB_TOKEN: T.String(),
});

export type Env = StaticDecode<typeof envSchema>;
