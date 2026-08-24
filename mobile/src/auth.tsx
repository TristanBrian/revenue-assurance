import {createContext,useContext,useEffect,useMemo,useState} from "react";
import * as api from "./api";
type V={user:api.User|null;loading:boolean;login:(e:string,p:string)=>Promise<void>;logout:()=>Promise<void>};const C=createContext<V|null>(null);
export function AuthProvider({children}:{children:React.ReactNode}){const[user,setUser]=useState<api.User|null>(null),[loading,setLoading]=useState(true);useEffect(()=>{void(async()=>{try{if(await api.session())setUser(await api.me())}catch{await api.logout()}finally{setLoading(false)}})()},[]);const v=useMemo<V>(()=>({user,loading,login:async(e,p)=>setUser(await api.login(e,p)),logout:async()=>{await api.logout();setUser(null)}}),[user,loading]);return <C.Provider value={v}>{children}</C.Provider>}
export function useAuth(){const v=useContext(C);if(!v)throw new Error("AuthProvider missing");return v}
