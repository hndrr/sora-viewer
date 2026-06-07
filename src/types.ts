export interface Generation {
  id: string;
  task_id: string;
  width: number;
  height: number;
  title: string;
  prompt: string;
  url: string;
  _source: string;
  _local: boolean;
}
