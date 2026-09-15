import type { Metadata } from "next";
import Script from "next/script";
import { Inter, Outfit } from "next/font/google";
import { AuthProvider } from "@/lib/auth-context";
import { ThemeProvider } from "@/context/ThemeContext";
import { DirectionProvider } from "@/context/DirectionContext";
import { MaterialityProvider } from "@/context/MaterialityContext";
import { APP_CONFIG } from "@/config/app-config";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-inter",
  display: "swap",
});

const outfit = Outfit({
  subsets: ["latin"],
  weight: ["500", "600", "700", "800", "900"],
  variable: "--font-outfit",
  display: "swap",
});

const THEME_INIT_SCRIPT = `(function(){try{var m=localStorage.getItem("kpc_theme_mode");var mode=(m==="light"||m==="dark"||m==="system")?m:"dark";var dark=mode==="dark"||(mode==="system"&&window.matchMedia("(prefers-color-scheme: dark)").matches);if(dark)document.documentElement.classList.add("dark");}catch(e){}})();`;

const CHATBASE_INIT_SCRIPT = `(function(){try{if(!window.chatbase||window.chatbase("getState")!=="initialized"){window.chatbase=(...args)=>{if(!window.chatbase.q){window.chatbase.q=[]}window.chatbase.q.push(args)};window.chatbase=new Proxy(window.chatbase,{get(target,prop){if(prop==="q"){return target.q}return(...args)=>target(prop,...args)}})}const onLoad=function(){try{const script=document.createElement("script");script.src="https://www.chatbase.co/embed.min.js";script.id="I_eSFKTVoDdB73xhXWx5F";script.domain="www.chatbase.co";script.async=true;script.onerror=function(){console.warn("Chatbase widget unavailable");};document.body.appendChild(script);}catch(e){console.warn(e);}};if(document.readyState==="complete"){onLoad();}else{window.addEventListener("load",onLoad,{once:true});}}catch(e){console.warn(e);}})();`;

export const metadata: Metadata = {
  title: `${APP_CONFIG.name} – ${APP_CONFIG.tagline}`,
  description: `${APP_CONFIG.name} (${APP_CONFIG.tagline}) Order-to-Cash & Stipend reconciliation dashboard`,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`h-full antialiased ${inter.variable} ${outfit.variable}`}
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
          <AuthProvider>
            <DirectionProvider>
              <MaterialityProvider>
                {children}
              </MaterialityProvider>
            </DirectionProvider>
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}