declare module 'zustand' {
  type SetState<T> = (partial: T | Partial<T> | ((state: T) => T | Partial<T>)) => void;
  type GetState<T> = () => T;
  type StateCreator<T> = (set: SetState<T>, get: GetState<T>) => T;
  type UseBoundStore<T> = {
    (): T;
    <U>(selector: (state: T) => U): U;
    getState: GetState<T>;
    setState: SetState<T>;
  };
  export function create<T>(initializer: StateCreator<T>): UseBoundStore<T>;
}
