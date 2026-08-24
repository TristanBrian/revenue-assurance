import{Stack}from"expo-router";import{StatusBar}from"expo-status-bar";import{AuthProvider}from"@/auth";import{c}from"@/theme";
export default function Layout(){return <AuthProvider><StatusBar style="light"/><Stack screenOptions={{headerShown:false,contentStyle:{backgroundColor:c.bg}}}/></AuthProvider>}
