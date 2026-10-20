import type { LastGoalWorkflow } from '../api.ts';

type Workflow = LastGoalWorkflow['workflow'];
type Field = keyof Workflow;
const fields: Field[] = ['profile', 'tdd', 'ponytail'];

interface WorkflowState {
  defaults: Workflow;
  values: Workflow;
  request: number;
  lastGoal: LastGoalWorkflow | null;
  inherited: Field[];
  followUp: boolean;
}
type Event =
  | { type: 'settings'; values: Workflow }
  | { type: 'pending'; request: number }
  | { type: 'validated'; request: number; ok: boolean; lastGoal: LastGoalWorkflow | null }
  | { type: 'edit'; field: Field; value: Partial<Workflow> }
  | { type: 'follow-up'; values: Workflow };

export function initialWorkflow(): WorkflowState {
  const defaults: Workflow = { profile: 'mattpocock', tdd: 'required', ponytail: 'on' };
  return { defaults, values: defaults, request: 0, lastGoal: null, inherited: [], followUp: false };
}

export function updateWorkflow(state: WorkflowState, event: Event, changed: ReadonlySet<string>): WorkflowState {
  if (event.type === 'edit') return { ...state, values: { ...state.values, ...event.value }, inherited: state.inherited.filter((f) => f !== event.field) };
  if (event.type === 'follow-up') return {
    ...state,
    values: {
      ...event.values,
      tdd: changed.has('tdd') ? state.values.tdd : event.values.tdd,
      ponytail: changed.has('ponytail') ? state.values.ponytail : event.values.ponytail,
    },
    inherited: [], lastGoal: null, followUp: true,
  };
  if (event.type === 'validated' && event.request !== state.request) return state;

  const next = { ...state };
  let source = next.defaults;
  if (event.type === 'settings') source = next.defaults = event.values;
  if (event.type === 'pending') {
    next.request = event.request;
    next.lastGoal = null;
    next.inherited = [];
  }
  if (event.type === 'validated') {
    if (!event.ok || !event.lastGoal || state.followUp) return next;
    source = event.lastGoal.workflow;
    next.lastGoal = event.lastGoal;
    next.inherited = fields.filter((f) => !changed.has(f));
  }
  next.values = { ...state.values };
  for (const field of fields) {
    if (changed.has(field) || state.followUp || (event.type === 'settings' && state.inherited.includes(field))) continue;
    Object.assign(next.values, { [field]: source[field] });
  }
  return next;
}
