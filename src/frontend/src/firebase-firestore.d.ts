// Type stubs for firebase/firestore — project uses Supabase, not Firebase.
// These stubs exist only to satisfy tsc for legacy Admin.tsx imports.
declare module 'firebase/firestore' {
  export function collection(db: any, path: string): any;
  export function getDocs(query: any): Promise<any>;
  export function doc(db: any, path: string, id: string): any;
  export function setDoc(ref: any, data: any): Promise<void>;
  export function deleteDoc(ref: any): Promise<void>;
  export function addDoc(ref: any, data: any): Promise<any>;
  export function updateDoc(ref: any, data: any): Promise<void>;
  export function query(ref: any, ...args: any[]): any;
  export function where(field: string, op: string, value: any): any;
  export function orderBy(field: string, dir?: string): any;
  export function onSnapshot(ref: any, callback: (snapshot: any) => void): () => void;
}
