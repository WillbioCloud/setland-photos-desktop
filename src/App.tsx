import React, { useState, useEffect } from 'react';
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

export type UserRole = 'operador' | 'gerente' | 'dono';

function App() {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isAdminModalOpen, setIsAdminModalOpen] = useState(false);
  
  // Controle de acesso global
  const [userRole, setUserRole] = useState<UserRole>('operador');

  useEffect(() => {
    const handleCartNavigation = () => setActiveTab('pdv');
    window.addEventListener('add-to-cart', handleCartNavigation);
    return () => window.removeEventListener('add-to-cart', handleCartNavigation);
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

  return (
    <div className="min-h-screen bg-brand-bg text-brand-ink font-sans selection:bg-brand-accent/30 flex flex-col transition-colors duration-300 ease-out">
      <Header 
        activeTab={activeTab} 
        setActiveTab={setActiveTab} 
        userRole={userRole}
        onAdminClick={() => setIsAdminModalOpen(true)}
        onNewClientClick={() => setIsModalOpen(true)}
        onLogout={() => setUserRole('operador')}
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