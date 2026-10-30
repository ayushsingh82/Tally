import type { ReactNode } from "react";
import { DappProvider } from "@/dapp";
import Shell from "@/ui/Shell";

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <DappProvider>
      <Shell>{children}</Shell>
    </DappProvider>
  );
}
