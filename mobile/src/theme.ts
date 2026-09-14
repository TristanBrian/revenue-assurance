export const c={bg:"#F3F6FB",card:"#FFFFFF",line:"#D8E2EE",text:"#10233E",muted:"#51627A",red:"#BE342F",redSoft:"#FBEAE8",amber:"#B27A0D",green:"#2E7D5B",blue:"#476A86",cyan:"#BE342F",sidebar:"#0A192F",sidebarCard:"#18394A",sidebarText:"#F7F3F0",sidebarMuted:"#A9B9CE"};
export const money=(n=0)=>"KES "+new Intl.NumberFormat("en-KE",{maximumFractionDigits:0}).format(n);
export const compactMoney=(n=0)=>n>=1e9?`KES ${(n/1e9).toFixed(2)}B`:n>=1e6?`KES ${(n/1e6).toFixed(2)}M`:n>=1e3?`KES ${(n/1e3).toFixed(1)}K`:money(n);
