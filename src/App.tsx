import { useState, useEffect } from "react";
import Header from './components/Header';
import Dashboard from './components/Dashboard';
import GlobalUploadModal from './components/GlobalUploadModal';
import Clientes from './components/Clientes';
import PDV from './components/PDV';
import Pacotes from './components/Pacotes';
import Historico from './components/Historico';
import AdminLoginModal from './components/AdminLoginModal';
import Equipe from './components/Equipe';
import Settings from './components/Settings';
import { Toaster } from "@/components/ui/sonner"
import LoginScreen from './components/LoginScreen';
import { supabase } from '@/lib/supabaseClient';
import { processWebhookOutbox } from '@/lib/webhookOutbox';
import { toast } from 'sonner';

export type UserRole = 'operador' | 'gerente' | 'dono';

function App() {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isAdminModalOpen, setIsAdminModalOpen] = useState(false);
  
  // Controle de acesso global
  const [userRole, setUserRole] = useState<UserRole>('operador');
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isAuthChecking, setIsAuthChecking] = useState(true);

  // Carrega a sessão salva no disco e detecta a role do usuário
  useEffect(() => {
    const checkInitialSession = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        
        if (session?.user) {
          const { data: profile } = await supabase
            .from('system_users')
            .select('role')
            .eq('id', session.user.id)
            .maybeSingle();

          const role = (profile?.role || session.user.user_metadata?.role || 'operador') as UserRole;
          setUserRole(role);
          setIsAuthenticated(true);
        } else {
          setIsAuthenticated(false);
        }
      } catch (err) {
        console.error('Erro ao verificar sessão salva:', err);
        setIsAuthenticated(false);
      } finally {
        setIsAuthChecking(false);
      }
    };

    checkInitialSession();

    // Escuta mudanças de auth (logout, expiração ou troca de conta)
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) {
        setIsAuthenticated(false);
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  const handleLoginSuccess = (role: UserRole) => {
    setUserRole(role);
    setIsAuthenticated(true);
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    setIsAuthenticated(false);
    setUserRole('operador');
  };

  useEffect(() => {
    const handleCartNavigation = () => setActiveTab('pdv');
    window.addEventListener('add-to-cart', handleCartNavigation);
    return () => window.removeEventListener('add-to-cart', handleCartNavigation);
  }, []);

  // Reprocessa entregas de WhatsApp que falharam em expedientes anteriores e
  // continua tentando a cada 2 minutos enquanto o terminal estiver aberto.
  useEffect(() => {
    const drain = () => { void processWebhookOutbox(); };

    drain();
    const interval = setInterval(drain, 120_000);

    const handleOutboxEvent = (e: Event) => {
      const detail = (e as CustomEvent).detail as { orderId?: string; status?: string; error?: string };
      if (detail?.status === 'dead') {
        toast.error('Entrega de WhatsApp perdida', {
          description: `Pedido ${detail.orderId} esgotou as tentativas de envio (${detail.error}). Envie o link manualmente.`,
          duration: 15000
        });
      }
    };

    window.addEventListener('webhook-outbox', handleOutboxEvent);
    return () => {
      clearInterval(interval);
      window.removeEventListener('webhook-outbox', handleOutboxEvent);
    };
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        document.activeElement?.tagName === 'INPUT' ||
        document.activeElement?.tagName === 'TEXTAREA' ||
        document.activeElement?.tagName === 'SELECT'
      ) {
        return;
      }

      if (e.code === 'Numpad7' || e.key === 'Enter' || e.key === 'F7') {
        if (document.getElementById('presentation-modal')) {
          return; // Bloqueia o atalho se a tela cheia de apresentação estiver aberta
        }
        e.preventDefault();
        setIsModalOpen(true);
      }
      
      if (e.key === 'Escape') {
        setIsModalOpen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const renderContent = () => {
    switch (activeTab) {
      case 'dashboard':
        return <Dashboard userRole={userRole} />;
      case 'clientes':
        return <Clientes />;
      case 'pacotes':
        return <Pacotes userRole={userRole} />;
      case 'pdv':
        return <PDV />;
      case 'historico':
        return <Historico />;
      case 'equipe':
        return <Equipe userRole={userRole} />;
      case 'configuracoes':
        return <Settings userRole={userRole} />;
      default:
        return <Dashboard />;
    }
  };

  if (isAuthChecking) {
    return (
      <div className="min-h-screen bg-brand-bg flex items-center justify-center">
        <div className="text-brand-accent animate-pulse font-mono text-sm">Carregando Terminal...</div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <LoginScreen onLoginSuccess={handleLoginSuccess} />;
  }

  return (
    <div className="min-h-screen bg-brand-bg text-brand-ink font-sans selection:bg-brand-accent/30 flex flex-col transition-colors duration-300 ease-out">
      <Header 
        activeTab={activeTab} 
        setActiveTab={setActiveTab} 
        userRole={userRole}
        onAdminClick={() => setIsAdminModalOpen(true)}
        onNewClientClick={() => setIsModalOpen(true)}
        onLogout={handleLogout}
      />
      
      <main className="flex-1 overflow-hidden p-4 md:p-6 flex flex-col">
        <div className="flex-1 w-full max-w-7xl mx-auto overflow-y-auto pr-2 no-scrollbar">
          {renderContent()}
        </div>
      </main>

      <GlobalUploadModal 
        isOpen={isModalOpen} 
        onClose={() => setIsModalOpen(false)} 
      />

      <AdminLoginModal 
        isOpen={isAdminModalOpen}
        onClose={() => setIsAdminModalOpen(false)}
        onLoginSuccess={(role) => setUserRole(role)}
      />
      <Toaster />
    </div>
  );
}

export default App;