// Ícones dos tipos de tarefa (o banco guarda o nome do ícone).
import {
  Briefcase,
  CalendarCheck,
  Car,
  CircleCheck,
  FileText,
  Flag,
  Mail,
  MapPin,
  MessageCircle,
  Phone,
  Timer,
  Users,
  Utensils,
  Video,
  type LucideIcon,
} from "lucide-react";

export const ACTIVITY_ICONS: Record<string, LucideIcon> = {
  phone: Phone,
  users: Users,
  "calendar-check": CalendarCheck,
  timer: Timer,
  flag: Flag,
  utensils: Utensils,
  mail: Mail,
  "map-pin": MapPin,
  video: Video,
  "message-circle": MessageCircle,
  "file-text": FileText,
  briefcase: Briefcase,
  car: Car,
  "circle-check": CircleCheck,
};

export function ActivityIcon({ name, size = 16, className }: { name: string; size?: number; className?: string }) {
  const Icon = ACTIVITY_ICONS[name] ?? CircleCheck;
  return <Icon size={size} className={className} />;
}
