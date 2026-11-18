const demoUser='Dr. Mario Rossi';

export function AppHeader(){
  return <header className="app-header" aria-label="Application header">
    <img className="app-brand-image" src="/branding/logo2.png" alt="Perinome" width="2172" height="724"/>
    <div className="app-user" title="Demo user">
      <span>{demoUser}</span>
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
        <circle cx="12" cy="12" r="9"/><circle cx="12" cy="9" r="3"/><path d="M5.5 18c1-3 3.2-4.3 6.5-4.3s5.5 1.3 6.5 4.3"/>
      </svg>
    </div>
  </header>;
}
