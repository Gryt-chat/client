/*
 * The icons this app draws, over @phosphor-icons/react.
 *
 * These used to come from react-icons/pi, which is the same phosphor artwork
 * repackaged. Both were installed: react-icons at 82MB for these 129 icons, and
 * @phosphor-icons/react at 31MB underneath @gryt/ui, which needs it anyway. So
 * this draws from the one that was already there and react-icons is gone.
 *
 * Neither ever reached an installer — Vite inlines what is used and the asar
 * carries none of node_modules — so this is 82MB off every checkout and every
 * CI run, and nothing off what anybody downloads.
 *
 * The names are unchanged on purpose. react-icons puts the weight in the name
 * and phosphor puts it in a prop, so a rename would have meant editing 291 call
 * sites and getting the weight right at each one. Here it is written once per
 * icon, mechanically, from the name it already had. The Pi prefix is still
 * accurate: it was always phosphor.
 *
 * Adding an icon: import the base from @phosphor-icons/react and export it
 * here, wrapped if it needs a weight.
 */

import type { Icon, IconProps } from "@phosphor-icons/react";
import {
  ArrowBendUpLeft,
  ArrowFatLineDown,
  ArrowLineLeft,
  ArrowLineRight,
  ArrowsClockwise,
  ArrowsLeftRight,
  ArrowSquareOut,
  At,
  Boot,
  Broadcast,
  Bug,
  Camera,
  CaretDown,
  CaretLeft,
  CaretRight,
  CaretUp,
  ChatCircle,
  ChatCircleDots,
  Chats,
  Check,
  CheckCircle,
  Clock,
  ClockClockwise,
  CloudArrowDown,
  CloudArrowUp,
  Code,
  Copy,
  CopySimple,
  CornersIn,
  CornersOut,
  Desktop,
  DotsThreeVertical,
  DownloadSimple,
  Envelope,
  Eye,
  FadersHorizontal,
  File,
  FileAudio,
  FileText,
  FileVideo,
  FileZip,
  Flag,
  Flask,
  Folder,
  GameController,
  Gauge,
  Gear,
  GearSix,
  HandWaving,
  HardDrives,
  Heart,
  House,
  Image,
  Info,
  Key,
  Keyboard,
  Link,
  LinkSimple,
  List,
  ListChecks,
  LockOpen,
  LockSimple,
  MagnifyingGlass,
  Microphone,
  MicrophoneSlash,
  Minus,
  MinusCircle,
  Monitor,
  MonitorArrowUp,
  Paperclip,
  PaperPlaneRight,
  PaperPlaneTilt,
  PencilSimple,
  Phone,
  PhoneCall,
  PhoneDisconnect,
  PhoneX,
  Play,
  Plus,
  Prohibit,
  PushPin,
  PushPinSlash,
  PuzzlePiece,
  Robot,
  ScanSmiley,
  Screencast,
  ShieldCheck,
  SignIn,
  SignOut,
  Signpost,
  SlidersHorizontal,
  Smiley,
  SpeakerHigh,
  SpeakerSimpleHigh,
  SpeakerSimpleSlash,
  SpeakerSlash,
  SquaresFour,
  Stop,
  Trash,
  UploadSimple,
  User,
  UserCircle,
  Users,
  UsersThree,
  VideoCamera,
  VideoCameraSlash,
  Warning,
  WarningCircle,
  WebhooksLogo,
  WifiSlash,
  X,
  XCircle,
} from "@phosphor-icons/react";

/**
 * A phosphor icon fixed at one weight.
 *
 * Fixed rather than defaulted, because these are passed around as values as
 * well as rendered — the settings tabs hold one per row — and a default would
 * only apply where somebody remembered to spread props.
 */
function weighted(Base: Icon, weight: IconProps["weight"], name: string): Icon {
  const Fixed = (props: IconProps) => <Base weight={weight} {...props} />;
  Fixed.displayName = name;
  return Fixed as Icon;
}

export const PiArrowBendUpLeftFill: Icon = weighted(ArrowBendUpLeft, "fill", "PiArrowBendUpLeftFill");
export const PiArrowFatLineDownFill: Icon = weighted(ArrowFatLineDown, "fill", "PiArrowFatLineDownFill");
export const PiArrowLineLeftFill: Icon = weighted(ArrowLineLeft, "fill", "PiArrowLineLeftFill");
export const PiArrowLineRightFill: Icon = weighted(ArrowLineRight, "fill", "PiArrowLineRightFill");
export const PiArrowsClockwiseBold: Icon = weighted(ArrowsClockwise, "bold", "PiArrowsClockwiseBold");
export const PiArrowsClockwiseFill: Icon = weighted(ArrowsClockwise, "fill", "PiArrowsClockwiseFill");
export const PiArrowsLeftRightFill: Icon = weighted(ArrowsLeftRight, "fill", "PiArrowsLeftRightFill");
export const PiArrowSquareOutBold: Icon = weighted(ArrowSquareOut, "bold", "PiArrowSquareOutBold");
export const PiArrowSquareOutFill: Icon = weighted(ArrowSquareOut, "fill", "PiArrowSquareOutFill");
export const PiAtFill: Icon = weighted(At, "fill", "PiAtFill");
export const PiBootFill: Icon = weighted(Boot, "fill", "PiBootFill");
export const PiBroadcastFill: Icon = weighted(Broadcast, "fill", "PiBroadcastFill");
export const PiBugFill: Icon = weighted(Bug, "fill", "PiBugFill");
export const PiCameraFill: Icon = weighted(Camera, "fill", "PiCameraFill");
export const PiCaretDownBold: Icon = weighted(CaretDown, "bold", "PiCaretDownBold");
export const PiCaretDownFill: Icon = weighted(CaretDown, "fill", "PiCaretDownFill");
export const PiCaretLeftFill: Icon = weighted(CaretLeft, "fill", "PiCaretLeftFill");
export const PiCaretRightBold: Icon = weighted(CaretRight, "bold", "PiCaretRightBold");
export const PiCaretRightFill: Icon = weighted(CaretRight, "fill", "PiCaretRightFill");
export const PiCaretUpFill: Icon = weighted(CaretUp, "fill", "PiCaretUpFill");
export const PiChatCircleDotsFill: Icon = weighted(ChatCircleDots, "fill", "PiChatCircleDotsFill");
export const PiChatCircleFill: Icon = weighted(ChatCircle, "fill", "PiChatCircleFill");
export const PiChatsFill: Icon = weighted(Chats, "fill", "PiChatsFill");
export const PiCheck: Icon = Check;
export const PiCheckBold: Icon = weighted(Check, "bold", "PiCheckBold");
export const PiCheckCircleFill: Icon = weighted(CheckCircle, "fill", "PiCheckCircleFill");
export const PiClockClockwiseFill: Icon = weighted(ClockClockwise, "fill", "PiClockClockwiseFill");
export const PiClockFill: Icon = weighted(Clock, "fill", "PiClockFill");
export const PiCloudArrowDownFill: Icon = weighted(CloudArrowDown, "fill", "PiCloudArrowDownFill");
export const PiCloudArrowUpFill: Icon = weighted(CloudArrowUp, "fill", "PiCloudArrowUpFill");
export const PiCode: Icon = Code;
export const PiCopyBold: Icon = weighted(Copy, "bold", "PiCopyBold");
export const PiCopyFill: Icon = weighted(Copy, "fill", "PiCopyFill");
export const PiCopySimple: Icon = CopySimple;
export const PiCopySimpleBold: Icon = weighted(CopySimple, "bold", "PiCopySimpleBold");
export const PiCornersInFill: Icon = weighted(CornersIn, "fill", "PiCornersInFill");
export const PiCornersOutFill: Icon = weighted(CornersOut, "fill", "PiCornersOutFill");
export const PiDesktopFill: Icon = weighted(Desktop, "fill", "PiDesktopFill");
export const PiDotsThreeVerticalBold: Icon = weighted(DotsThreeVertical, "bold", "PiDotsThreeVerticalBold");
export const PiDownloadSimpleFill: Icon = weighted(DownloadSimple, "fill", "PiDownloadSimpleFill");
export const PiEnvelopeFill: Icon = weighted(Envelope, "fill", "PiEnvelopeFill");
export const PiEyeFill: Icon = weighted(Eye, "fill", "PiEyeFill");
export const PiFadersHorizontalFill: Icon = weighted(FadersHorizontal, "fill", "PiFadersHorizontalFill");
export const PiFileAudioFill: Icon = weighted(FileAudio, "fill", "PiFileAudioFill");
export const PiFileFill: Icon = weighted(File, "fill", "PiFileFill");
export const PiFileTextFill: Icon = weighted(FileText, "fill", "PiFileTextFill");
export const PiFileVideoFill: Icon = weighted(FileVideo, "fill", "PiFileVideoFill");
export const PiFileZipFill: Icon = weighted(FileZip, "fill", "PiFileZipFill");
export const PiFlagFill: Icon = weighted(Flag, "fill", "PiFlagFill");
export const PiFlaskFill: Icon = weighted(Flask, "fill", "PiFlaskFill");
export const PiFolderFill: Icon = weighted(Folder, "fill", "PiFolderFill");
export const PiGameControllerFill: Icon = weighted(GameController, "fill", "PiGameControllerFill");
export const PiGaugeFill: Icon = weighted(Gauge, "fill", "PiGaugeFill");
export const PiGearFill: Icon = weighted(Gear, "fill", "PiGearFill");
export const PiGearSixFill: Icon = weighted(GearSix, "fill", "PiGearSixFill");
export const PiHandWavingFill: Icon = weighted(HandWaving, "fill", "PiHandWavingFill");
export const PiHardDrivesFill: Icon = weighted(HardDrives, "fill", "PiHardDrivesFill");
export const PiHeartFill: Icon = weighted(Heart, "fill", "PiHeartFill");
export const PiHouseFill: Icon = weighted(House, "fill", "PiHouseFill");
export const PiImageFill: Icon = weighted(Image, "fill", "PiImageFill");
export const PiInfoBold: Icon = weighted(Info, "bold", "PiInfoBold");
export const PiInfoFill: Icon = weighted(Info, "fill", "PiInfoFill");
export const PiKey: Icon = Key;
export const PiKeyboardFill: Icon = weighted(Keyboard, "fill", "PiKeyboardFill");
export const PiKeyFill: Icon = weighted(Key, "fill", "PiKeyFill");
export const PiLinkFill: Icon = weighted(Link, "fill", "PiLinkFill");
export const PiLinkSimpleBold: Icon = weighted(LinkSimple, "bold", "PiLinkSimpleBold");
export const PiList: Icon = List;
export const PiListChecksFill: Icon = weighted(ListChecks, "fill", "PiListChecksFill");
export const PiLockOpen: Icon = LockOpen;
export const PiLockSimpleFill: Icon = weighted(LockSimple, "fill", "PiLockSimpleFill");
export const PiMagnifyingGlassBold: Icon = weighted(MagnifyingGlass, "bold", "PiMagnifyingGlassBold");
export const PiMagnifyingGlassFill: Icon = weighted(MagnifyingGlass, "fill", "PiMagnifyingGlassFill");
export const PiMicrophoneFill: Icon = weighted(Microphone, "fill", "PiMicrophoneFill");
export const PiMicrophoneSlashFill: Icon = weighted(MicrophoneSlash, "fill", "PiMicrophoneSlashFill");
export const PiMinusBold: Icon = weighted(Minus, "bold", "PiMinusBold");
export const PiMinusCircleFill: Icon = weighted(MinusCircle, "fill", "PiMinusCircleFill");
export const PiMonitorArrowUpFill: Icon = weighted(MonitorArrowUp, "fill", "PiMonitorArrowUpFill");
export const PiMonitorFill: Icon = weighted(Monitor, "fill", "PiMonitorFill");
export const PiPaperclipFill: Icon = weighted(Paperclip, "fill", "PiPaperclipFill");
export const PiPaperPlaneRightFill: Icon = weighted(PaperPlaneRight, "fill", "PiPaperPlaneRightFill");
export const PiPaperPlaneTiltFill: Icon = weighted(PaperPlaneTilt, "fill", "PiPaperPlaneTiltFill");
export const PiPencilSimpleBold: Icon = weighted(PencilSimple, "bold", "PiPencilSimpleBold");
export const PiPencilSimpleFill: Icon = weighted(PencilSimple, "fill", "PiPencilSimpleFill");
export const PiPhoneCallFill: Icon = weighted(PhoneCall, "fill", "PiPhoneCallFill");
export const PiPhoneDisconnectFill: Icon = weighted(PhoneDisconnect, "fill", "PiPhoneDisconnectFill");
export const PiPhoneFill: Icon = weighted(Phone, "fill", "PiPhoneFill");
export const PiPhoneXFill: Icon = weighted(PhoneX, "fill", "PiPhoneXFill");
export const PiPlayFill: Icon = weighted(Play, "fill", "PiPlayFill");
export const PiPlus: Icon = Plus;
export const PiPlusBold: Icon = weighted(Plus, "bold", "PiPlusBold");
export const PiProhibitBold: Icon = weighted(Prohibit, "bold", "PiProhibitBold");
export const PiProhibitFill: Icon = weighted(Prohibit, "fill", "PiProhibitFill");
export const PiPushPinFill: Icon = weighted(PushPin, "fill", "PiPushPinFill");
export const PiPushPinSlashFill: Icon = weighted(PushPinSlash, "fill", "PiPushPinSlashFill");
export const PiPuzzlePieceFill: Icon = weighted(PuzzlePiece, "fill", "PiPuzzlePieceFill");
export const PiRobotFill: Icon = weighted(Robot, "fill", "PiRobotFill");
export const PiScanSmileyFill: Icon = weighted(ScanSmiley, "fill", "PiScanSmileyFill");
export const PiScreencastFill: Icon = weighted(Screencast, "fill", "PiScreencastFill");
export const PiShieldCheckFill: Icon = weighted(ShieldCheck, "fill", "PiShieldCheckFill");
export const PiSignInBold: Icon = weighted(SignIn, "bold", "PiSignInBold");
export const PiSignInFill: Icon = weighted(SignIn, "fill", "PiSignInFill");
export const PiSignOutBold: Icon = weighted(SignOut, "bold", "PiSignOutBold");
export const PiSignOutFill: Icon = weighted(SignOut, "fill", "PiSignOutFill");
export const PiSignpost: Icon = Signpost;
export const PiSlidersHorizontalFill: Icon = weighted(SlidersHorizontal, "fill", "PiSlidersHorizontalFill");
export const PiSmileyFill: Icon = weighted(Smiley, "fill", "PiSmileyFill");
export const PiSpeakerHighFill: Icon = weighted(SpeakerHigh, "fill", "PiSpeakerHighFill");
export const PiSpeakerSimpleHighFill: Icon = weighted(SpeakerSimpleHigh, "fill", "PiSpeakerSimpleHighFill");
export const PiSpeakerSimpleSlashFill: Icon = weighted(SpeakerSimpleSlash, "fill", "PiSpeakerSimpleSlashFill");
export const PiSpeakerSlashFill: Icon = weighted(SpeakerSlash, "fill", "PiSpeakerSlashFill");
export const PiSquaresFourFill: Icon = weighted(SquaresFour, "fill", "PiSquaresFourFill");
export const PiStopFill: Icon = weighted(Stop, "fill", "PiStopFill");
export const PiTrashBold: Icon = weighted(Trash, "bold", "PiTrashBold");
export const PiTrashFill: Icon = weighted(Trash, "fill", "PiTrashFill");
export const PiUploadSimple: Icon = UploadSimple;
export const PiUploadSimpleFill: Icon = weighted(UploadSimple, "fill", "PiUploadSimpleFill");
export const PiUserCircleFill: Icon = weighted(UserCircle, "fill", "PiUserCircleFill");
export const PiUserFill: Icon = weighted(User, "fill", "PiUserFill");
export const PiUsersFill: Icon = weighted(Users, "fill", "PiUsersFill");
export const PiUsersThreeFill: Icon = weighted(UsersThree, "fill", "PiUsersThreeFill");
export const PiVideoCameraFill: Icon = weighted(VideoCamera, "fill", "PiVideoCameraFill");
export const PiVideoCameraSlashFill: Icon = weighted(VideoCameraSlash, "fill", "PiVideoCameraSlashFill");
export const PiWarningCircle: Icon = WarningCircle;
export const PiWarningCircleFill: Icon = weighted(WarningCircle, "fill", "PiWarningCircleFill");
export const PiWarningFill: Icon = weighted(Warning, "fill", "PiWarningFill");
export const PiWebhooksLogoFill: Icon = weighted(WebhooksLogo, "fill", "PiWebhooksLogoFill");
export const PiWifiSlashFill: Icon = weighted(WifiSlash, "fill", "PiWifiSlashFill");
export const PiX: Icon = X;
export const PiXCircleFill: Icon = weighted(XCircle, "fill", "PiXCircleFill");
