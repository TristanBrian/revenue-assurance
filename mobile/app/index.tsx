import{Redirect}from"expo-router";import{ActivityIndicator,View}from"react-native";import{useAuth}from"@/auth";import{c}from"@/theme";
export default function Index(){const{user,loading}=useAuth();return loading?<View style={{flex:1,justifyContent:"center"}}><ActivityIndicator color={c.cyan}/></View>:<Redirect href={user?"/(tabs)":"/login"}/>}
