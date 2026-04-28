import api from './api'

export async function getDebtCards() {
  const { data } = await api.get('/debt/cards')
  return data
}

export async function createDebtCard(cardData) {
  const { data } = await api.post('/debt/cards', cardData)
  return data
}

export async function updateDebtCard(id, cardData) {
  const { data } = await api.put(`/debt/cards/${id}`, cardData)
  return data
}

export async function deleteDebtCard(id) {
  const { data } = await api.delete(`/debt/cards/${id}`)
  return data
}
