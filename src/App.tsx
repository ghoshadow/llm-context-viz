import { useSessionStore } from './store/sessionStore';
import { useUIStore } from './store/uiStore';
import HomePage from './components/home/HomePage';
import ContextAssembly from './components/pages/ContextAssembly';
import TurnInspector from './components/pages/TurnInspector';
import OntologyPage from './components/ontology/OntologyPage';
import CalibratePage from './components/pages/CalibratePage';
import ScannerModal from './components/upload/ScannerModal';

function App() {
  const page = useUIStore(s => s.page);
  const currentSessionId = useSessionStore(s => s.currentSessionId);
  const scannerOpen = useSessionStore(s => s.scannerOpen);

  return (
    <div style={{minHeight: '100vh', background: 'radial-gradient(1200px 700px at 80% -10%, oklch(0.22 0.03 285 / 0.45), transparent 60%), oklch(0.155 0.008 265)', color: 'oklch(0.93 0.006 265)', fontFamily: "'IBM Plex Sans', system-ui, sans-serif", padding: '30px 38px 70px', letterSpacing: '-0.01em'}}>
      {page === 'home' && <HomePage />}
      {page === 'assembly' && currentSessionId && <ContextAssembly />}
      {page === 'inspector' && currentSessionId && <TurnInspector />}
      {page === 'ontology' && currentSessionId && <OntologyPage />}
      {page === 'calibrate' && <CalibratePage />}
      {scannerOpen && <ScannerModal />}
    </div>
  );
}

export default App;
