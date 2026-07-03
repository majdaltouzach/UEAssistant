import Store from 'electron-store'
import { Get } from 'type-fest'

import {
  UserInfo,
  RecentGame,
  HiddenGame,
  FavouriteGame,
  DMQueueElement,
  AppSettings,
  WindowProps,
  UploadedLogData
} from 'common/types'

export interface StoreStructure {
  configStore: {
    userHome: string
    userInfo: UserInfo
    games: {
      recent: RecentGame[]
      hidden: HiddenGame[]
      favourites: FavouriteGame[]
      customCategories: Record<string, string[]>
    }
    theme: string
    zoomPercent: number
    contentFontFamily: string
    actionsFontFamily: string
    allTilesInColor: boolean
    titlesAlwaysVisible: boolean
    disableDialogBackdropClose: boolean
    disableAnimations: boolean
    language: string
    'general-logs': {
      currentLogFile: string
      lastLogFile: string
      legendaryLogFile: string
    }
    'window-props': WindowProps
    settings: AppSettings
    skipVcRuntime: boolean
    showSnapWarning: boolean
  }
  timestampStore: {
    [K: string]: {
      firstPlayed: string
      lastPlayed: string
      totalPlayed: number
    }
  }
  fontsStore: {
    fonts: string[]
  }
  downloadManager: {
    queue: DMQueueElement[]
    finished: DMQueueElement[]
  }
  uploadedLogs: Record<string, UploadedLogData>
  migrationsStore: {
    appliedMigrations: string[]
  }
  gameOverridesStore: {
    overrides: Record<
      string,
      {
        title?: string
        art_cover?: string
        art_square?: string
      }
    >
  }
}

export type StoreOptions<T extends Record<string, unknown>> = Store.Options<T>
export type ValidStoreName = keyof StoreStructure

// This is `T`, *except* for when `T` is `unknown`; it then is `never`
// Credits for this goes to michael#7468 on the TS Community Discord server
export type UnknownGuard<T> = unknown extends T
  ? [T] extends [null]
    ? T
    : never
  : T

export abstract class TypeCheckedStore<Name extends ValidStoreName> {
  abstract has(key: string): boolean

  abstract get<KeyType extends string>(
    key: KeyType,
    defaultValue: NonNullable<UnknownGuard<Get<StoreStructure[Name], KeyType>>>
  ): NonNullable<UnknownGuard<Get<StoreStructure[Name], KeyType>>>

  abstract get_nodefault<KeyType extends string>(
    key: KeyType
  ): UnknownGuard<Get<StoreStructure[Name], KeyType> | undefined>

  abstract set<KeyType extends string>(
    key: KeyType,
    value: UnknownGuard<Get<StoreStructure[Name], KeyType>>
  ): void

  // FIXME: This is currently not type-checked properly
  abstract delete<KeyType extends string>(key: KeyType): void

  abstract clear(): void
}
