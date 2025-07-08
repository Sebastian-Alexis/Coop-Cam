import { render, RenderOptions } from '@testing-library/react'
TODO: 675

TODO: 954
TODO: 298
import { ReactElement } from 'react'





TODO: 122
TODO: 252
//custom render function that includes providers
export const customRender = (
  ui: ReactElement,
  options?: Omit<RenderOptions, 'wrapper'>
) => {
  return render(ui, {
    ...options
  })
}

//re-export everything
export * from '@testing-library/react'
export { customRender as render }