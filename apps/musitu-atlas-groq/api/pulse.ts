export default function handler(req:any,res:any){
 if(req.method!=='GET')return res.status(405).json({error:'Method not allowed'});
 return res.setHeader('Cache-Control','no-store').status(200).json({
   ok:true,provider:'Groq',aiConfigured:Boolean(process.env.GROQ_API_KEY),
   now:new Date().toISOString()
 });
}