/* Barrel export for the FairShift UI primitive library. */
export { Icon, type IconProps } from "./icon";
export { Avatar, AvatarStack, type AvatarProps, type AvatarStackProps } from "./avatar";
export { Button, type ButtonProps, type ButtonVariant } from "./button";
export { Badge, type BadgeProps } from "./badge";
export { Card, type CardProps } from "./card";
export { Ring, type RingProps } from "./ring";
export { Bar, type BarProps } from "./bar";
export { Spark, type SparkProps } from "./spark";
export { MetricCard, type MetricCardProps } from "./metric-card";
export { Check, type CheckProps } from "./check";
export { STATUS, type Tone } from "@/lib/status";

/* ---- Interaction primitives (Foundation phase) ---- */
export { Modal, type ModalProps, type ModalSize } from "./modal";
export {
  Field,
  TextField,
  TextArea,
  Select,
  type FieldProps,
  type TextFieldProps,
  type TextAreaProps,
  type SelectProps,
  type SelectOption,
} from "./field";
export { Switch, type SwitchProps } from "./switch";
export { Tabs, type TabsProps } from "./tabs";
export { SearchInput, type SearchInputProps } from "./search-input";
export { Pagination, type PaginationProps } from "./pagination";
export { EmptyState, type EmptyStateProps } from "./empty-state";
export { Menu, type MenuProps, type MenuItem } from "./menu";
export { ToastProvider, useToast, type ToastOptions } from "./toast";
export { ConfirmProvider, useConfirm, type ConfirmOptions } from "./confirm";
