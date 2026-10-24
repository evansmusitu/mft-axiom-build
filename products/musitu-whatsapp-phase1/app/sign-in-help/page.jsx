export const dynamic='force-dynamic';
export const metadata={title:'Sign-in help | MUSITU',referrer:'no-referrer'};

export default function SignInHelp(){
 return <main className="content" style={{maxWidth:'42rem',paddingTop:'12vh'}}>
  <p className="eyebrow">MUSITU · PRIVATE STAGING</p>
  <section className="panel" aria-labelledby="sign-in-heading">
   <h1 id="sign-in-heading">Sign-in could not finish</h1>
   <p className="subtitle">Your sign-in was not completed. The temporary sign-in window may have expired.</p>
   <p className="subtitle">Start again when you are ready. If your identity provider keeps showing an error, contact your administrator before retrying.</p>
   <p style={{margin:'2rem 0'}}><a className="login-btn" href="/auth/login">Start a new sign-in</a></p>
   <a href="/">Return to overview</a>
  </section>
 </main>;
}
