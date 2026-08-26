import type { Metadata } from "next";
import Script from "next/script";
import { AuthProvider } from "@/lib/auth-context";
import { ThemeProvider } from "@/context/ThemeContext";
import "./globals.css";

const THEME_INIT_SCRIPT = `(function(){try{var m=localStorage.getItem("kpc_theme_mode");var mode=(m==="light"||m==="dark"||m==="system")?m:"dark";var dark=mode==="dark"||(mode==="system"&&window.matchMedia("(prefers-color-scheme: dark)").matches);if(dark)document.documentElement.classList.add("dark");}catch(e){}})();`;

// Chatbase support-chat widget — standard embed snippet, only the bot id
// (I_eSFKTVoDdB73xhXWx5F) is account-specific. Loaded afterInteractive since
// it's a non-blocking widget, not something the first paint depends on.
const CHATBASE_INIT_SCRIPT = `(function(){if(!window.chatbase||window.chatbase("getState")!=="initialized"){window.chatbase=(...arguments)=>{if(!window.chatbase.q){window.chatbase.q=[]}window.chatbase.q.push(arguments)};window.chatbase=new Proxy(window.chatbase,{get(target,prop){if(prop==="q"){return target.q}return(...args)=>target(prop,...args)}})}const onLoad=function(){const script=document.createElement("script");script.src="https://www.chatbase.co/embed.min.js";script.id="I_eSFKTVoDdB73xhXWx5F";script.domain="www.chatbase.co";document.body.appendChild(script)};if(document.readyState==="complete"){onLoad()}else{window.addEventListener("load",onLoad)}})();`;

export const metadata: Metadata = {
  title: "KPC Revenue Assurance",
  description: "Order-to-Cash reconciliation dashboard",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className="h-full antialiased"
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col">
        {/* next/script beforeInteractive — the App Router's supported way to
            block on a script before hydration/paint (a plain <script> tag in
            JSX here is not executed by React's client renderer). Sets the
            correct theme class on <html> before the first paint, so there's
            no light->dark->saved-theme flash. suppressHydrationWarning above
            stops React reverting the class this adds ahead of hydration. */}
        <Script id="theme-init" strategy="beforeInteractive">
          {THEME_INIT_SCRIPT}
        </Script>
        <Script id="chatbase-init" strategy="afterInteractive">
          {CHATBASE_INIT_SCRIPT}
        </Script>
        <ThemeProvider>
          <AuthProvider>{children}</AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
