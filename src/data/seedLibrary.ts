import type { ChatMessage } from '../types/library';

export const INITIAL_CHAT_MESSAGES: ChatMessage[] = [
  {
    id: 'msg_welcome_1',
    sender: 'assistant',
    text: '¡Bienvenido a KomoLib! 📚 Soy tu asistente literario con IA. Puedo ayudarte a buscar en tu biblioteca, analizar tus lecturas, recomendar libros, mangas o manhwas, o guardar notas rápidas escribiendo "/nota ...". ¿Qué estamos leyendo hoy?',
    createdAt: Date.now() - 2000,
  },
];
