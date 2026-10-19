import {catalog} from './_frontier.js';
export default function handler(req:any,res:any){
 if(req.method!=='GET')return res.status(405).json({error:'Method not allowed'});
 res.setHeader('Cache-Control','no-store');
 return res.status(200).json({models:catalog(),paidMode:'disabled-by-default'});
}