import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './context/AuthContext'
import Layout from './components/Layout'
import LoginPage from './pages/LoginPage'
import RegisterPage from './pages/RegisterPage'
import DashboardPage from './pages/DashboardPage'
import TaskDetailPage from './pages/TaskDetailPage'
import CategoriesPage from './pages/CategoriesPage'
import SettingsPage from './pages/SettingsPage'
import WorkoutPlansPage from './pages/workout/WorkoutPlansPage'
import ExercisesPage from './pages/workout/ExercisesPage'
import ExerciseDetailPage from './pages/workout/ExerciseDetailPage'
import PlanBuilderPage from './pages/workout/PlanBuilderPage'
import ActiveWorkoutPage from './pages/workout/ActiveWorkoutPage'
import DebtFlowPage from './pages/debt/DebtFlowPage'

function RequireAuth({ children }) {
  const { user } = useAuth()
  return user ? children : <Navigate to="/login" replace />
}

function GuestOnly({ children }) {
  const { user } = useAuth()
  return !user ? children : <Navigate to="/" replace />
}

export default function App() {
  return (
    <Routes>
      {/* Guest routes */}
      <Route path="/login" element={<GuestOnly><LoginPage /></GuestOnly>} />
      <Route path="/register" element={<GuestOnly><RegisterPage /></GuestOnly>} />

      {/* Protected routes */}
      <Route path="/" element={<RequireAuth><Layout /></RequireAuth>}>
        <Route index element={<DashboardPage />} />
        <Route path="tasks/:id" element={<TaskDetailPage />} />
        <Route path="categories" element={<CategoriesPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="workout" element={<WorkoutPlansPage />} />
        <Route path="workout/exercises" element={<ExercisesPage />} />
        <Route path="workout/exercises/:id" element={<ExerciseDetailPage />} />
        <Route path="workout/plans/new" element={<PlanBuilderPage />} />
        <Route path="workout/plans/:id/edit" element={<PlanBuilderPage />} />
        <Route path="workout/active/:dayId" element={<ActiveWorkoutPage />} />
        <Route path="debt" element={<DebtFlowPage />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
